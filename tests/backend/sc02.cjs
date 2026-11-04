const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),p=require('path'),crypto=require('crypto');
const root=p.resolve(__dirname,'../..'),state=JSON.parse(fs.readFileSync(p.join(root,'runtime/sc02/state.json'))),access=JSON.parse(fs.readFileSync(p.join(root,'runtime/b1/access.json'))),{Pool}=require(p.join(root,'apps/platform/node_modules/pg'));
const db=new Pool({connectionString:state.env.MIGRATION_DATABASE_URL}),uid=()=>crypto.randomUUID(),base='http://127.0.0.1:44692/api/v1';let admin;
const dh={Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':state.env.OVALITY_EDGE_TOKEN};
async function req(path,body,h=dh,method=body===undefined?'GET':'POST'){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...h},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()}}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data}
const cmd=(path,b)=>req(path,b,{...admin,'Idempotency-Key':uid()});
const label=t=>'HYT1'+t.id.replaceAll('-','').toUpperCase()+'V1';
const route='/devices/HY-BY-01/task-scan';
test('SC02 real PG and HTTP atomic scanner lifecycle',async t=>{try{
 const login=await req('/auth/login',{username:'admin',password:access.users.admin},{});const loginData=ok(login);admin={Cookie:login.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':loginData.csrf_token};
 const wo=ok(await cmd('/work-orders',{external_code:'SC02扫码换盘验收-'+Date.now(),specification_id:'SP220-1200'}));const tasks=[];
 for(let i=1;i<=5;i++){const spool=ok(await cmd('/spools',{work_order_id:wo.id,spool_code:'SC02线缆'+i,specification_id:'SP220-1200'}));tasks.push(ok(await cmd('/tasks',{work_order_id:wo.id,spool_id:spool.id,specification_id:'SP220-1200',process_id:'process-by',device_id:'HY-BY-01',metric_code:'OVALITY',recipe_version_id:'BY-V1.0',planned_length_m:'100'})))}
 const read=async id=>(await db.query('SELECT state,version FROM m02.inspection_task WHERE id=$1',[id])).rows[0];
 let a,b;
 await t.test('created task can be previewed; off/invalid/unauthorized routes do not mutate',async()=>{
  assert.equal(ok(await req('/devices/HY-BY-01/scan-preview/'+label(tasks[0]))).state,'CREATED');
  const body={command_id:uid(),barcode:label(tasks[0]),expected_task_id:null,expected_binding_id:null};
  assert.equal((await req(route,body,{Authorization:dh.Authorization})).status,403);
  assert.equal((await req(route,body,admin)).status,403);
  assert.equal((await req('/devices/HY-JX-01/task-scan',body)).status,409);assert.equal((await read(tasks[0].id)).state,'CREATED');
 });
 await t.test('first scan starts task; same command replays without new binding',async()=>{
  const body={command_id:uid(),barcode:label(tasks[0]),expected_task_id:null,expected_binding_id:null};a=ok(await req(route,body));assert.equal((await read(tasks[0].id)).state,'RUNNING');assert.deepEqual(ok(await req(route,body)),a);
  assert.equal((await req(route,{...body,barcode:label(tasks[1])})).status,409);
 });
 await t.test('stale revision / invalid next task rollback old task',async()=>{
  const body={command_id:uid(),barcode:label(tasks[1]).replace('V1','V2'),expected_task_id:tasks[0].id,expected_binding_id:a.label.binding_id};assert.equal((await req(route,body)).status,409);
  await db.query("UPDATE m01.product_specification SET enabled=false WHERE id='SP220-1200'");
  try{assert.equal((await req(route,{...body,command_id:uid(),barcode:label(tasks[1])})).status,422);assert.equal((await read(tasks[0].id)).state,'RUNNING');assert.equal((await read(tasks[1].id)).state,'CREATED')}finally{await db.query("UPDATE m01.product_specification SET enabled=true WHERE id='SP220-1200'")}
 });
 await t.test('switch closes old and starts next atomically; concurrent old binding rejects',async()=>{
  b=ok(await req(route,{command_id:uid(),barcode:label(tasks[1]),expected_task_id:tasks[0].id,expected_binding_id:a.label.binding_id}));assert.equal(b.ended_task_id,tasks[0].id);assert.equal((await read(tasks[0].id)).state,'ENDED');assert.equal((await read(tasks[1].id)).state,'RUNNING');
  assert.equal((await req(route,{command_id:uid(),barcode:label(tasks[2]),expected_task_id:tasks[0].id,expected_binding_id:a.label.binding_id})).status,409);
  assert.equal(ok(await req('/devices/HY-BY-01/scan-preview/'+label(tasks[0]))).state,'ENDED'); // SC03 permits a new independent execution.
  assert.equal((await db.query("SELECT count(*)::int n FROM m02.inspection_task WHERE device_id='HY-BY-01' AND state='RUNNING'")).rows[0].n,1);
 });
 await t.test('power off ends center task and audits device identity; duplicate stop safe',async()=>{
  const stop={command_id:uid(),expected_task_id:tasks[1].id,expected_binding_id:b.label.binding_id};ok(await req('/devices/HY-BY-01/task-stop',stop));ok(await req('/devices/HY-BY-01/task-stop',stop));ok(await req('/devices/HY-BY-01/task-stop',{...stop,command_id:uid()}));
  assert.equal((await read(tasks[1].id)).state,'ENDED');const audit=(await db.query("SELECT * FROM m00.audit_event WHERE action='TASK_END' AND resource_id=$1",[tasks[1].id])).rows;assert.equal(audit.length,1);assert.equal(audit[0].actor_type,'DEVICE');
 });
 await t.test('simultaneous scans have exactly one winner',async()=>{
  const scans=await Promise.all(tasks.slice(2,4).map(task=>req(route,{command_id:uid(),barcode:label(task),expected_task_id:null,expected_binding_id:null})));
  assert.deepEqual(scans.map(r=>r.status).sort(),[200,409]);const win=ok(scans.find(r=>r.status===200));
  assert.equal((await db.query("SELECT count(*)::int n FROM m02.inspection_task WHERE device_id='HY-BY-01' AND state='RUNNING'")).rows[0].n,1);
  ok(await req('/devices/HY-BY-01/task-stop',{command_id:uid(),expected_task_id:win.label.task_id,expected_binding_id:win.label.binding_id}));
 });
 fs.writeFileSync(p.join(root,'runtime/sc02/tasks.json'),JSON.stringify({wo,tasks,codes:tasks.map(label)}));
}finally{await db.end()}});
