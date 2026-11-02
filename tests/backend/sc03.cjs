const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),p=require('path'),crypto=require('crypto');
const root=p.resolve(__dirname,'../..'),state=JSON.parse(fs.readFileSync(p.join(root,'runtime/sc03/state.json'))),access=JSON.parse(fs.readFileSync(p.join(root,'runtime/b1/access.json'))),{Pool}=require(p.join(root,'apps/platform/node_modules/pg'));
const db=new Pool({connectionString:state.env.MIGRATION_DATABASE_URL}),uid=()=>crypto.randomUUID(),base='http://127.0.0.1:44992/api/v1';let admin;
const dh={Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':state.env.OVALITY_EDGE_TOKEN};
async function req(path,body,h=dh){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...h},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()}}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data}
const cmd=(path,b)=>req(path,b,{...admin,'Idempotency-Key':uid()});
const label=t=>'HYT1'+t.id.replaceAll('-','').toUpperCase()+'V1',route='/devices/HY-BY-01/task-scan';
test('SC03 real PostgreSQL / HTTP separate scan executions',async t=>{try{
 const login=await req('/auth/login',{username:'admin',password:access.users.admin},{});admin={Cookie:login.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':ok(login).csrf_token};
 const wo=ok(await cmd('/work-orders',{external_code:'SC03重复扫码验收-'+Date.now(),specification_id:'SP220-1200'}));const spool=ok(await cmd('/spools',{work_order_id:wo.id,spool_code:'SC03同盘分次采集',specification_id:'SP220-1200'}));
 const task=ok(await cmd('/tasks',{work_order_id:wo.id,spool_id:spool.id,specification_id:'SP220-1200',process_id:'process-by',device_id:'HY-BY-01',metric_code:'OVALITY',recipe_version_id:'BY-V1.0',planned_length_m:'100'}));
 const read=async id=>(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1',[id])).rows[0];
 const body=(active,code=label(task))=>({command_id:uid(),barcode:code,expected_task_id:active?.task_id??null,expected_binding_id:active?.binding_id??null});
 const stop=async active=>ok(await req('/devices/HY-BY-01/task-stop',{command_id:uid(),expected_task_id:active.task_id,expected_binding_id:active.binding_id}));
 let a,b,c,old;
 await t.test('first scan uses original task; response replay idempotent',async()=>{const input=body();a=ok(await req(route,input)).label;assert.equal(a.task_id,task.id);assert.deepEqual(ok(await req(route,input)).label,a);});
 await t.test('same running code creates separate execution, binding, frozen rule, audit',async()=>{
  const input=body(a);b=ok(await req(route,input)).label;assert.notEqual(a.task_id,b.task_id);assert.notEqual(a.binding_id,b.binding_id);old=await read(a.task_id);assert.equal(old.state,'ENDED');
  const row=await read(b.task_id);assert.equal(row.context_snapshot.scan_execution.round,2);assert.equal(row.context_snapshot.scan_execution.source_task_id,task.id);assert.equal(row.spool_id,task.spool_id);assert.deepEqual(row.rule_snapshot,task.rule_snapshot);assert.equal(row.state,'RUNNING');assert.equal(b.order.scanRound,2);
  assert.deepEqual(ok(await req(route,input)).label,b);assert.equal((await db.query("SELECT count(*)::int n FROM m00.audit_event WHERE action='TASK_SCAN_REPEAT' AND resource_id=$1",[b.task_id])).rows[0].n,1);
 });
 await t.test('finished original code creates third execution without rewriting either old record',async()=>{await stop(b);const before=await read(b.task_id);assert.equal(ok(await req('/devices/HY-BY-01/scan-preview/'+label(task))).state,'ENDED');c=ok(await req(route,body())).label;assert.equal(c.order.scanRound,3);assert.deepEqual(await read(a.task_id),old);assert.deepEqual(await read(b.task_id),before);});
 await t.test('failure and stale command rollback current execution',async()=>{
  assert.equal((await req(route,body(c,label(task).replace('V1','V2')))).status,409);assert.equal((await req(route,body(a))).status,409);
  await db.query("UPDATE m01.product_specification SET enabled=false WHERE id='SP220-1200'");try{assert.equal((await req(route,body(c))).status,422);assert.equal((await read(c.task_id)).state,'RUNNING');}finally{await db.query("UPDATE m01.product_specification SET enabled=true WHERE id='SP220-1200'")}
 });
 await t.test('concurrent scans create only one next execution; source search returns separate rows',async()=>{
  const r=await Promise.all([req(route,body(c)),req(route,body(c))]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);const win=ok(r.find(x=>x.status===200)).label;assert.equal(win.order.scanRound,4);await stop(win);
  const list=ok(await req('/production/tasks?q='+task.task_code,undefined,admin));assert.equal(list.total,4);assert.equal(new Set(list.items.map(x=>x.id)).size,4);
 });
 await t.test('cancelled code, wrong device and missing edge token are rejected without creating tasks',async()=>{
  const before=Number((await db.query('SELECT count(*) n FROM m02.inspection_task')).rows[0].n);
  const input=body();assert.equal((await req('/devices/HY-JX-01/task-scan',input)).status,409);assert.equal((await req(route,input,{Authorization:dh.Authorization})).status,403);
  await db.query("UPDATE m02.inspection_task SET state='CANCELLED' WHERE id=$1",[task.id]);
  try{assert.equal((await req(route,body())).status,409)}finally{await db.query("UPDATE m02.inspection_task SET state='ENDED' WHERE id=$1",[task.id])}
  assert.equal(Number((await db.query('SELECT count(*) n FROM m02.inspection_task')).rows[0].n),before);
 });
 fs.writeFileSync(p.join(root,'runtime/sc03/tasks.json'),JSON.stringify({wo,task,spool,code:label(task)}));
}finally{await db.end()}});
