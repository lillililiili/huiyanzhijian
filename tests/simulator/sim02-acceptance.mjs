import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg'),fixture=JSON.parse(readFileSync('runtime/sim02/private.json','utf8'));
const db=new Pool({connectionString:fixture.env.DATABASE_URL});let cookie='',csrf='',simCookie='',simCsrf='';const results=[];
async function call(base,path,body,headers={}){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
async function p(path,body,extra={}){const r=await call('http://127.0.0.1:4205/api/v1',path,body,{Cookie:cookie,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),...extra});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;}
const sim=(path,body,extra={})=>call('http://127.0.0.1:4206/api',path,body,{Cookie:simCookie,'X-Sim-CSRF':simCsrf,...extra});
async function ok(path,body,status=200){const r=await sim(path,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
async function until(fn){for(let n=0;n<180;n++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,250));}throw Error('Timed out');}
const cable={name:'三项缺陷线缆',material_ref:'sim02-'+Date.now(),length_m:'10',baseline:{tape_width_mm:'20',overlap_width_mm:'2.5',wire_gap_mm:'1.25',diameter_x_mm:'40',diameter_y_mm:'40'},defects:[{name:'搭盖不足',metric:'SHIELD_OVERLAP_RATE',start_m:'2',length_m:'1',value_mm:'1'},{name:'间隙过宽',metric:'WIRE_GAP',start_m:'4',length_m:'2',value_mm:'4'},{name:'椭圆段',metric:'OVALITY',start_m:'7',length_m:'1',value_mm:'48'}]};
try{
 const login=await call('http://127.0.0.1:4205/api/v1','/auth/login',{username:'admin',password:'123456'});assert.equal(login.status,200);cookie=login.cookies.map(c=>c.split(';')[0]).join('; ');csrf=login.body.data.csrf_token;
 assert.equal((await sim('/models/cables')).status,401);const sl=await sim('/login',{username:'admin',password:'123456'});assert.equal(sl.status,200);simCookie=sl.cookies.map(c=>c.split(';')[0]).join('; ');simCsrf=sl.body.csrf;
 const cinput={id:randomUUID(),version:0,data:cable,reason:'独立联调'};assert.equal((await sim('/models/cables',cinput,{'X-Sim-CSRF':''})).status,403);
 const c=await ok('/models/cables',cinput);assert.equal((await ok('/models/cables',cinput)).version,1);assert.equal((await sim('/models/cables',{...cinput,data:{...cable,length_m:'0'}})).status,400);results.push('authentication/csrf/model-persistence/idempotency/invalid-model');
 const spec=await p('/catalog/specifications',{code:'SIM02-'+Date.now(),name:'三指标复合结构测试',voltage_kv:'35',conductor_area_mm2:'400',core_count:1,shield_structure:'combined',enabled:true,cable_model:'SIM02',customer_code:'',product_type:'',description:'',reason:'隔离测试',applicability:[['dg','SHIELD_OVERLAP_RATE'],['jx','WIRE_GAP'],['by','OVALITY']].map(([m,k])=>({process_id:'process-'+m,metric_code:k}))});
 const order=await p('/work-orders',{external_code:'SIM02-'+Date.now(),specification_id:spec.id}),spool=await p('/spools',{work_order_id:order.id,spool_code:cable.material_ref});
 const devices=[];let count=0;
 for(const [m,id,metric,lower,upper,expected] of [['dg','HY-DG-01','SHIELD_OVERLAP_RATE','10','',2],['jx','HY-JX-01','WIRE_GAP','','3',4],['by','HY-BY-01','OVALITY','','8',2]]){
  let task=await p('/tasks',{work_order_id:order.id,spool_id:spool.id,specification_id:spec.id,process_id:'process-'+m,device_id:id,metric_code:metric,recipe_version_id:null,planned_length_m:'10'});task=await p('/tasks/'+task.id+':start',{}, {'If-Match':String(task.version)});
  const d=await ok('/models/detectors',{id:randomUUID(),version:0,data:{name:m+'模拟设备',device_id:id,metric,step_m:'0.5',speed_m_min:'600',lower,upper},reason:'隔离测试'});devices.push(d);
  const input={request_id:randomUUID(),cable_id:c.id,cable_version:1,detector_id:d.id,detector_version:1,mode:'BOUND',task_id:task.id,spool_id:spool.id};const run=await ok('/passes',input,202);
  assert.equal((await ok('/passes',input,202)).id,run.id);assert.equal((await sim('/passes',{...input,request_id:randomUUID()})).status,409);
  await until(async()=>{const r=(await ok('/state')).runs.find(r=>r.id===run.run_id);return r?.job.status==='SUCCEEDED'&&r.stored===20;});
  const comparison=await ok('/passes/'+run.run_id);assert.equal(comparison.defects.find(x=>x.metric===metric).detected,expected);assert.ok(comparison.defects.filter(x=>x.metric!==metric).every(x=>x.detected===0));
  const stored=(await db.query('SELECT raw_payload FROM m04.measurement_record WHERE task_id=$1 ORDER BY capture_sequence::bigint',[task.id])).rows;
  assert.equal(stored.length,20);assert.equal(stored.filter(x=>x.raw_payload.values[0].source_quality_result==='FAIL').length,expected);assert.ok(stored.every(x=>!JSON.stringify(x).includes('defects')&&!JSON.stringify(x).includes('搭盖不足')));
  assert.equal((await p('/measurements?task_id='+task.id)).items.length,20);
  if(m==='dg'){await ok('/runs/'+run.run_id+'/control',{action:'replay'});await until(async()=>{const r=(await ok('/state')).runs.find(r=>r.id===run.run_id);return r?.job.status==='SUCCEEDED';});assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record WHERE task_id=$1',[task.id])).rows[0].count,'20');}
  task=await p('/tasks/'+task.id);await p('/tasks/'+task.id+':end',{reason:'隔离模拟完成'},{'If-Match':String(task.version)});count+=20;results.push(metric+'/expected-detection/local-truth-isolation/PostgreSQL-history');
 }
 // AUTO path must fail honestly before configuration, then safely retry the same pass.
 const d=devices[0],auto={request_id:randomUUID(),cable_id:c.id,cable_version:1,detector_id:d.id,detector_version:1,mode:'AUTO',task_id:'',spool_id:spool.id};
 assert.equal((await sim('/passes',auto)).status,409);
 await p('/discovery-profiles/HY-DG-01',{enabled:true,specification_id:spec.id,recipe_version_id:null},{'If-Match':'0'});
 const arun=await ok('/passes',auto,202);const compared=await until(async()=>{const r=await ok('/passes/'+arun.run_id);return r.exit?r:null;});assert.equal(compared.exit.state,'ENDED');assert.equal(Number(compared.exit.reported_length_m),10);assert.equal(compared.enter.spool_id,spool.id);
 assert.equal((await ok('/passes/'+arun.run_id+'/finish',{})).task_id,compared.exit.task_id);count+=20;results.push('auto-disabled/retry/enter-detect-exit/length/task-ended/idempotent-exit');
 const changed=await ok('/models/cables',{...cinput,version:1,data:{...cable,name:'修订后线缆'},reason:'新版本'});assert.equal(changed.version,2);assert.equal((await ok('/passes/'+arun.run_id)).cable.version,1);assert.equal((await sim('/models/cables',{...cinput,data:{...cable,name:'旧版本修改'}})).status,412);results.push('version-conflict/frozen-pass-snapshot');
 writeFileSync('临时文件夹/SIM02_双模块模拟/api-results.json',JSON.stringify({database:fixture.name,results,records:count,spool_id:spool.id,specification_id:spec.id,cable:c,detectors:devices,auto_run:arun.run_id,auto_task:compared.exit.task_id},null,2));console.log(JSON.stringify({passed:results.length,records:count,database:fixture.name}));
}finally{await db.end();}
