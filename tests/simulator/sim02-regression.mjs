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
 const sl=await sim('/login',{username:'admin',password:'123456'});assert.equal(sl.status,200);simCookie=sl.cookies.map(c=>c.split(';')[0]).join('; ');simCsrf=sl.body.csrf;
 for(const old of (await ok('/state')).runs.filter(r=>r.scenario==='cable'&&r.control==='STOPPED'&&r.generated<r.target)){await until(async()=>{const result=await sim('/runs/'+old.id+'/control',{action:'resume'});if(result.status===409)return false;assert.equal(result.status,200);return true;});await until(async()=> (await ok('/passes/'+old.id)).exit);}
 const initial=await ok('/state');assert.ok(initial.totals.generated>=88);assert.equal(initial.totals.generated,initial.totals.stored);
 const existing=JSON.parse(readFileSync('临时文件夹/SIM02_双模块模拟/api-results.json','utf8'));assert.equal((await ok('/passes/'+existing.auto_run)).defects[0].detected,2);
 assert.equal((await ok('/models/cables')).find(c=>c.id===existing.cable.id).version,2);results.push('restart-models/queue/comparison-persist');
 const d=await ok('/models/detectors',{id:randomUUID(),version:0,data:{...existing.detectors[0].data,name:'暂停恢复设备',speed_m_min:'60'},reason:'控制回归'});
 const input={request_id:randomUUID(),cable_id:existing.cable.id,cable_version:1,detector_id:d.id,detector_version:1,mode:'AUTO',task_id:'',spool_id:existing.spool_id};
 const r=await ok('/passes',input,202);
 const run=async()=> (await ok('/state')).runs.find(x=>x.id===r.run_id);
 await until(async()=>(await run())?.generated>=2);await ok('/runs/'+r.run_id+'/control',{action:'pause'});await new Promise(r=>setTimeout(r,650));const paused=(await run()).generated;await new Promise(r=>setTimeout(r,650));assert.equal((await run()).generated,paused);
 await ok('/runs/'+r.run_id+'/control',{action:'stop'});await until(async()=> (await run()).job.status==='STOPPED');assert.equal((await ok('/passes/'+r.run_id)).exit,null);
 await until(async()=>{const resumed=await sim('/runs/'+r.run_id+'/control',{action:'resume'});if(resumed.status===409)return false;assert.equal(resumed.status,200);return true;});await until(async()=> (await ok('/passes/'+r.run_id)).exit);assert.equal((await run()).stored,20);assert.equal((await ok('/passes/'+r.run_id)).defects[0].detected,2);results.push('pause-freezes-feed/stop-retains/resume-original-position/automatic-exit');
 const event={request_id:randomUUID(),device_id:'HY-DG-01',encounter_id:'legacy-'+randomUUID(),phase:'ENTER',counter_id:'legacy-counter',value_m:'0',spool_id:existing.spool_id};await ok('/production-events',event);
 const legacy=await ok('/runs',{request_id:randomUUID(),device_id:'HY-DG-01',scenario:'mixed',count:4,interval_ms:50,seed:0},202);await until(async()=> (await ok('/state')).runs.find(x=>x.id===legacy.run_id)?.job.status==='SUCCEEDED');
 const detail=await ok('/runs/'+legacy.run_id);assert.equal(detail.items.length,4);assert.equal(detail.items.filter(x=>x.payload.values[0].value===null).length,1);await ok('/production-events',{...event,request_id:randomUUID(),phase:'EXIT',value_m:'1'});results.push('legacy-mixed/manual-events-compatible');
 const total=(await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count;assert.equal(Number(total),initial.totals.generated+24);
 const browser=(await db.query("SELECT r.position_m::text,v.value::text,v.source_quality_result FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id WHERE r.task_id='773c5344-dcc4-46a6-98b3-bd6d46790ea8' ORDER BY r.capture_sequence::bigint")).rows;assert.equal(browser.length,8);assert.equal(browser.filter(r=>r.source_quality_result==='FAIL').length,2);
 writeFileSync('临时文件夹/SIM02_双模块模拟/regression-results.json',JSON.stringify({results,total:Number(total),browser_readback:browser},null,2));console.log(JSON.stringify({passed:results.length,total:Number(total)}));
}finally{await db.end();}
