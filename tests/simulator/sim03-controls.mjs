// Requires the isolated SIM03 fixture and three-metric-regression setup; never points at shared services.
import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg'),f=JSON.parse(readFileSync('runtime/sim03/private.json','utf8')),db=new Pool({connectionString:f.env.DATABASE_URL});
let cookie='',csrf='';const results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,body,headers={}){const r=await fetch('http://127.0.0.1:4208/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Sim-CSRF':csrf,...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
async function ok(path,body,status=200){const r=await api(path,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;}
async function until(fn,label){for(let i=0;i<200;i++){const r=await fn();if(r)return r;await sleep(100);}throw Error('Timeout '+label);}
const byRun=async id=>(await ok('/state')).runs.find(r=>r.id===id);
try{
 const login=await api('/login',{username:'admin',password:'123456'});assert.equal(login.status,200);cookie=login.cookies.map(x=>x.split(';')[0]).join('; ');csrf=login.body.csrf;
 const prior=JSON.parse(readFileSync('临时文件夹/SIM03_实时送料控制/three-metric-results.json','utf8'));
 const c=await ok('/models/cables',{id:randomUUID(),version:0,data:{...prior.cable.data,name:'SIM03实时送料验收',material_ref:'sim03-'+Date.now(),length_m:'10'},reason:'隔离控制验收'});
 const d=await ok('/models/detectors',{id:randomUUID(),version:0,data:{...prior.detectors[0].data,name:'SIM03慢速设备',speed_m_min:'1'},reason:'隔离控制验收'});
 const input={request_id:randomUUID(),cable_id:c.id,cable_version:1,detector_id:d.id,detector_version:1,mode:'AUTO',task_id:'',spool_id:''};
 const created=await ok('/passes',input,202),id=created.run_id;
 await until(async()=>(await byRun(id))?.generated>=1,'first sample');
 const start=Date.now();await ok('/runs/'+id+'/control',{action:'pause'});const paused=await byRun(id);await sleep(400);assert.equal((await byRun(id)).generated,paused.generated);assert.ok(Date.now()-start<2000);results.push('30-second-interval/pause-persistent/no-new-sample');
 assert.equal((await api('/passes/'+id+'/speed',{speed_m_min:'60',version:0},{'X-Sim-CSRF':''})).status,403);
 for(const speed of ['0','601','0.1'])assert.equal((await api('/passes/'+id+'/speed',{speed_m_min:speed,version:0})).status,400);
 const speed=await ok('/passes/'+id+'/speed',{speed_m_min:'60',version:0});assert.equal(speed.interval_ms,500);assert.equal((await ok('/passes/'+id+'/speed',{speed_m_min:'60',version:0})).version,1);
 assert.equal((await api('/passes/'+id+'/speed',{speed_m_min:'30',version:0})).status,412);assert.equal((await api('/passes/missing/speed',{speed_m_min:'30',version:0})).status,404);
 assert.equal((await ok('/passes/'+id)).detector.data.speed_m_min,'1');results.push('speed/auth/invalid/conflict/idempotency/frozen-model');
 await ok('/runs/'+id+'/control',{action:'resume'});await until(async()=>(await byRun(id)).generated>=4,'speed applied');
 const stoppedAt=Date.now();await ok('/runs/'+id+'/control',{action:'stop'});const stop=await byRun(id);await until(async()=>(await byRun(id)).job.status==='STOPPED','process stop');await sleep(350);assert.equal((await byRun(id)).generated,stop.generated);
 const comparison=await ok('/passes/'+id);assert.equal(comparison.exit,null);assert.equal((await api('/passes/'+id+'/speed',{speed_m_min:'120',version:1})).status,409);results.push('stop/no-new-sample/no-fake-exit');
 await ok('/runs/'+id+'/control',{action:'resume'});await until(async()=>(await byRun(id)).job.status==='RUNNING','restart');await ok('/passes/'+id+'/speed',{speed_m_min:'600',version:1});
 const done=await until(async()=>{const r=await ok('/passes/'+id);return r.exit?r:null;},'automatic exit');assert.equal(done.exit.state,'ENDED');assert.equal(Number(done.exit.reported_length_m),10);
 const rows=(await db.query('SELECT raw_payload FROM m04.measurement_record WHERE task_id=$1 ORDER BY capture_sequence::bigint',[done.exit.task_id])).rows.map(x=>x.raw_payload);
 assert.equal(rows.length,20);assert.deepEqual(rows.map(x=>Number(x.capture_sequence)),Array.from({length:20},(_,i)=>i+1));assert.deepEqual(rows.map(x=>Number(x.position_m)),Array.from({length:20},(_,i)=>i*.5));assert.equal(rows.filter(x=>x.values[0].source_quality_result==='FAIL').length,2);
 results.push('immediate-resume/lease-ownership/sequences/positions/real-PostgreSQL');
 const ready=await byRun(id);assert.equal(ready.feed.speed.speed_m_min,'600');assert.equal(ready.feed.last_sample.position_m,'9.500000');assert.equal(ready.feed.exited,true);results.push('live-status/actual-last-sample/exit-status');
 writeFileSync('临时文件夹/SIM03_实时送料控制/control-results.json',JSON.stringify({results,run_id:id,task_id:done.exit.task_id,records:rows.length,stop_to_resume_test_ms:Date.now()-stoppedAt,cable_id:c.id,detector_id:d.id},null,2));console.log(JSON.stringify({passed:results.length,records:rows.length,run_id:id}));
}finally{await db.end();}
