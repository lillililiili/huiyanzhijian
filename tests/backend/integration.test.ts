import {rule01Cases} from './rule01-cases';
import {cat01Cases} from './cat01-cases';
import {b3r4Cases} from './b3r4-cases';
import {ad01Cases} from './ad01-cases';
import {b3Cases} from './b3-cases';
import {b3r3Cases} from './b3r3-cases';
import {b3r2Cases} from './b3r2-cases';
import {b3r1Cases} from './b3r1-cases';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
const require=createRequire(resolve('package.json'));const {Pool}=require('pg');
const root=resolve('../..'),platform=resolve('.'),simulator=resolve(root,'tools/simulator'),access=JSON.parse(readFileSync(resolve(root,'runtime/b1/access.json'),'utf8'));
const envFile=Object.fromEntries(readFileSync(resolve(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const p=l.indexOf('=');return [l.slice(0,p),l.slice(p+1)];}));
const dbName='hy_b1_test_'+Date.now(),evidence=resolve(root,'临时文件夹/第一阶段_B1后端模拟器',dbName);mkdirSync(evidence,{recursive:true});
const testPort=process.env.TEST_API_PORT||'4194';
const env={...process.env,...envFile,DATABASE_URL:envFile.DATABASE_URL.replace('/huiyan_b1','/'+dbName),MIGRATION_DATABASE_URL:envFile.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+dbName),PORT:testPort};
let api:ChildProcess,worker:ChildProcess;let apiLog='';const url='http://127.0.0.1:'+testPort+'/api/v1';const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function startApi(){const logStart=apiLog.length;api=spawn(process.execPath,['dist/composition/main.js'],{cwd:platform,env,stdio:['ignore','pipe','pipe']});api.stdout!.on('data',d=>apiLog+=d);api.stderr!.on('data',d=>apiLog+=d);for(let i=0;i<50;i++){try{if(api.exitCode!==null)throw Error('Test API exited before ready');if(apiLog.slice(logStart).includes('API_READY')&&(await fetch(url+'/health/ready')).ok)return;}catch{}await wait(100);}throw Error('API startup timeout');}
async function stop(p:ChildProcess){if(p&&!p.killed){p.kill();await Promise.race([once(p,'exit'),wait(2000)]);}}
async function req(path:string,method='GET',data?:any,headers:Record<string,string>={}){const r=await fetch(url+path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
async function login(username:string){const r=await req('/auth/login','POST',{username,password:access.users[username]});assert.equal(r.status,200,JSON.stringify(r.body));return {Cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':r.body.data.csrf_token};}
const deviceHeaders={Authorization:'Bearer '+access.device_token};
async function device(path:string,b?:any){return req(path,b===undefined?'GET':'POST',b,deviceHeaders);}
async function command(path:string,b:any,h:Record<string,string>,more:Record<string,string>={}){return req(path,'POST',b,{...h,'Idempotency-Key':randomUUID(),...more});}
async function sim(args:string[],extra:Record<string,string>={}){return new Promise<{code:number|null;out:string}>(resolveResult=>{const child=spawn(process.execPath,['dist/cli.js',...args],{cwd:simulator,env:{...process.env,API_URL:'http://127.0.0.1:'+testPort,DEVICE_TOKEN:access.device_token,SIM_DB:resolve(evidence,'queue.sqlite'),...extra},stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);child.on('exit',code=>resolveResult({code,out}));});}
test('B1 real PostgreSQL + HTTP + independent simulator acceptance', {timeout:180000},async t=>{
 const adminDb=new Pool({connectionString:envFile.MIGRATION_DATABASE_URL});await adminDb.query(`CREATE DATABASE ${dbName}`);await adminDb.end();
 execFileSync(process.execPath,['--import','tsx','db/migrate.ts'],{cwd:platform,env,stdio:'pipe'});execFileSync(process.execPath,['--import','tsx','db/migrate.ts'],{cwd:platform,env,stdio:'pipe'});execFileSync(process.execPath,['--import','tsx','db/bootstrap.ts'],{cwd:platform,env,stdio:'pipe'});
 const db=new Pool({connectionString:env.DATABASE_URL}),owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL});const results:string[]=[];
 try{
 await startApi();worker=spawn(process.execPath,['dist/composition/analysis-worker.js'],{cwd:platform,env,stdio:'ignore'});
 const admin=await login('admin'),viewer=await login('viewer');
 await t.test('initial business empty; fixed catalog persists; runtime cannot DDL',async()=>{
  assert.equal((await req('/tasks','GET',undefined,admin)).body.data.items.length,0);const c=await req('/catalog','GET',undefined,admin);assert.equal(c.body.data.device.length,3);assert.equal(c.body.data.product_specification.length,6);assert.equal((await req('/measurements','GET',undefined,admin)).body.data.items.length,0);
  await assert.rejects(db.query('CREATE TABLE public.forbidden(id integer)'),(e:any)=>e.code==='42501');results.push('empty/catalog/runtime-DDL');
 });
 await t.test('real authentication, CSRF, viewer/device scope',async()=>{
  assert.equal((await req('/auth/login','POST',{username:'admin',password:'incorrect'})).status,401);
  assert.equal((await req('/work-orders','POST',{external_code:'DENIED',specification_id:'SP035-400'},viewer)).status,403);
  assert.equal((await req('/work-orders','POST',{external_code:'DENIED',specification_id:'SP035-400'},deviceHeaders)).status,403);
  assert.equal((await req('/work-orders','POST',{external_code:'DENIED',specification_id:'SP035-400'},{Cookie:admin.Cookie})).status,403);results.push('auth/csrf/scope');
 });
 await t.test('roles in another factory cannot elevate the active factory permissions',async()=>{
  const user=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;
  await owner.query("INSERT INTO m00.user_role(user_id,role_code,factory_id) VALUES($1,'admin','z-other-factory')",[user]);
  try{assert.equal((await req('/work-orders','POST',{external_code:'CROSS-ROLE-DENIED',specification_id:'SP035-400'},viewer)).status,403);assert.equal((await req('/audit-events','GET',undefined,viewer)).status,403);}
  finally{await owner.query("DELETE FROM m00.user_role WHERE user_id=$1 AND factory_id='z-other-factory'",[user]);}results.push('cross-factory-role-isolation');
 });
 const tasks:any[]=[];const configs=[['HY-DG-01','SHIELD_OVERLAP_RATE','SP035-400','dg','DG-V1.0'],['HY-JX-01','WIRE_GAP','SP110-800','jx','JX-V1.0'],['HY-BY-01','OVALITY','SP220-1200','by','BY-V1.0']];
 for(const [deviceId,metric,spec,m,recipe] of configs){const wo=await command('/work-orders',{external_code:'ACCEPT-'+m,specification_id:spec},admin);assert.equal(wo.status,200,JSON.stringify(wo.body));const spool=await command('/spools',{work_order_id:wo.body.data.id,spool_code:'SAME-SPOOL'},admin);assert.equal(spool.status,200,JSON.stringify(spool.body));const b={work_order_id:wo.body.data.id,spool_id:spool.body.data.id,specification_id:spec,process_id:'process-'+m,device_id:deviceId,metric_code:metric,recipe_version_id:recipe,planned_length_m:'1000'};const key=randomUUID();const task=await command('/tasks',b,admin,{'Idempotency-Key':key});assert.equal(task.status,200,JSON.stringify(task.body));const retry=await command('/tasks',b,admin,{'Idempotency-Key':key});assert.equal(retry.body.data.id,task.body.data.id);assert.equal((await command('/tasks',{...b,planned_length_m:'2000'},admin,{'Idempotency-Key':key})).status,409);const start=await command('/tasks/'+task.body.data.id+':start',{},admin,{'If-Match':'1'});assert.equal(start.status,200,JSON.stringify(start.body));tasks.push(start.body.data);}
 results.push('work-order/spool/task/idempotency/binding');
 await t.test('three metrics independent simulator: 300 records persist and reconcile',async()=>{
  for(let i=0;i<configs.length;i++){const r=await sim(['run','--device',configs[i][0],'--run','accept-'+i,'--count','100','--interval-ms','50','--seed','0','--scenario','mixed']);writeFileSync(resolve(evidence,'simulator-'+i+'.log'),r.out);assert.equal(r.code,0,r.out);}
  const count=await db.query('SELECT v.metric_code,count(*) AS n,count(*) FILTER(WHERE v.value IS NULL) AS invalid,count(*) FILTER(WHERE e.quality_result=\'FAIL\') AS failed FROM m04.measurement_value v JOIN m04.measurement_evaluation e ON e.record_id=v.record_id GROUP BY v.metric_code');assert.equal(count.rowCount,3);for(const row of count.rows){assert.equal(row.n,'100');assert.equal(row.invalid,'25');assert.equal(row.failed,'25');}
  assert.equal((await db.query('SELECT count(*) FROM m04.measurement_outbox')).rows[0].count,'300');const replay=await sim(['replay','--run','accept-0','--interval-ms','50']);assert.equal(replay.code,0,replay.out);assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count,'300');results.push('three-metric-300/replay/invalid/boundary');
 });
 await t.test('acknowledgement keys are scoped to device, including duplicate replay',async()=>{
  for(const [deviceId] of configs.slice(0,2)){
   const assignment=(await device('/devices/'+deviceId+'/assignment')).body.data.assignment;
   const session=await device('/device-sessions',{schema_version:'1.0',device_id:deviceId,data_environment:'SIMULATED',client_session_id:'ack-scope-'+deviceId,producer_version:'acceptance'});
   const ack={schema_version:'1.0',ack_id:'same-vendor-local-ack',connection_id:session.body.data.connection_id,binding_id:assignment.binding_id,binding_version:assignment.binding_version,snapshot_hash:assignment.snapshot_hash,result:'APPLIED',effective_at:new Date().toISOString(),capture_session_id:'ack-scope-'+deviceId,first_capture_sequence:'1',reason_code:null};
   const first=await device('/devices/'+deviceId+'/assignment-acks',ack);assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.data.duplicate,false);
   assert.equal((await device('/devices/'+deviceId+'/assignment-acks',ack)).body.data.duplicate,true);
  }results.push('device-scoped-ack');
 });
 const sample=(await db.query('SELECT raw_payload FROM m04.measurement_record ORDER BY ingest_order LIMIT 1')).rows[0].raw_payload;
 const batch=(records:any[])=>({schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records});
 await t.test('mixed receipts, same-key conflicts and whole-batch scope preflight',async()=>{
  const r=await device('/measurements:ingest',batch([sample,{...sample,values:[{...sample.values[0],value:'9'}]},{}]));assert.equal(r.status,200);assert.deepEqual(r.body.data.items.map((x:any)=>x.receipt_status),['DUPLICATE','REJECTED','REJECTED']);
  const count=(await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count;const bad=await device('/measurements:ingest',batch([sample,{...sample,record_id:'forged',data_environment:'REAL'}]));assert.equal(bad.status,403);assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count,count);
  const unbound={...sample,record_id:'unbound',capture_session_id:'unknown',capture_sequence:'1',task_id:null,binding_id:null,binding_version:null};const q=await device('/measurements:ingest',batch([unbound]));assert.equal(q.body.data.items[0].receipt_status,'QUARANTINED');assert.equal((await device('/measurements:ingest',batch([unbound]))).body.data.items[0].initial_status,'QUARANTINED');results.push('mixed/conflict/preflight/quarantine');
 });
 await t.test('decimal and microsecond precision; concurrent dedup; raw immutability',async()=>{
  const precise={...sample,record_id:'precision',capture_session_id:'precision',capture_sequence:'18446744073709551615',task_id:null,binding_id:null,binding_version:null,sample_time:'2026-10-21T08:00:00.123456Z',position_m:'123.1234567891',values:[{...sample.values[0],value:'10.0000000001'}]};
  const responses=await Promise.all(Array.from({length:5},()=>device('/measurements:ingest',batch([precise]))));assert.equal(responses.filter(r=>r.body.data.items[0].receipt_status==='QUARANTINED').length,1);assert.equal(responses.filter(r=>r.body.data.items[0].receipt_status==='DUPLICATE').length,4);
  const row=await db.query("SELECT to_char(sample_time AT TIME ZONE 'UTC','HH24:MI:SS.US') AS t,position_m,v.value FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id WHERE source_record_key='precision'");assert.equal(row.rows[0].t,'08:00:00.123456');assert.equal(row.rows[0].position_m,'123.1234567891');assert.equal(row.rows[0].value,'10.0000000001');await assert.rejects(db.query("UPDATE m04.measurement_record SET raw_payload='{}'"),(e:any)=>e.code==='42501');results.push('microsecond/decimal/uint64/concurrency/immutability');
 });
 await t.test('sessions fence old heartbeat; duplicate sequence does not renew online',async()=>{
  const deviceId='HY-DG-01';const payload={schema_version:'1.0',device_id:deviceId,data_environment:'SIMULATED',client_session_id:randomUUID(),producer_version:'test'};const s=await device('/device-sessions',payload);assert.equal(s.status,200);const hb={schema_version:'1.0',device_id:deviceId,data_environment:'SIMULATED',connection_id:s.body.data.connection_id,heartbeat_sequence:'1',sent_at:new Date().toISOString(),capture_session_id:'hb-test',observed_task_id:null,observed_binding_id:null,last_sample_time:null,last_record_id:null,queue_depth:0,disk_free_bytes:'104857600',instrument_state:'READY',config_version:'test'};assert.equal((await device('/device-status:heartbeat',hb)).body.data.accepted,true);assert.equal((await device('/device-status:heartbeat',hb)).body.data.accepted,false);await device('/device-sessions',{...payload,client_session_id:randomUUID()});assert.equal((await device('/device-status:heartbeat',{...hb,heartbeat_sequence:'2'})).status,409);assert.equal((await device('/device-sessions',payload)).status,409);results.push('session-fence/heartbeat');
 });
 await t.test('cursor freezes query and rejects changed filters; audit and ingress diagnostics readable',async()=>{
  const first=await req('/measurements?limit=10','GET',undefined,admin);assert.equal(first.body.data.items.length,10);const cursor=encodeURIComponent(first.body.data.next_cursor);const next=await req('/measurements?limit=10&cursor='+cursor,'GET',undefined,admin);assert.equal(next.status,200);assert.notEqual(next.body.data.items[0].id,first.body.data.items[0].id);assert.equal((await req('/measurements?device_id=HY-JX-01&cursor='+cursor,'GET',undefined,admin)).status,400);assert.equal((await req('/audit-events','GET',undefined,viewer)).status,403);assert.ok((await req('/audit-events','GET',undefined,admin)).body.data.items.length);assert.ok((await req('/ingestion-batches','GET',undefined,admin)).body.data.items.length);results.push('query-cursor/audit/diagnostics');
 });
 await t.test('B2 descending filtered history preserves snapshot and validates scope',async()=>{
  const me=await req('/auth/me','GET',undefined,admin);assert.equal(me.body.data.user.username,'admin');
  const cat=await req('/catalog','GET',undefined,admin);assert.ok(cat.body.data.specification_applicability.length);
  const query='/measurements?order=desc&limit=7&task_ids='+tasks[0].id+','+tasks[1].id+'&quality=FAIL&environment=SIMULATED';
  const a=await req(query,'GET',undefined,admin);assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(a.body.data.items.length,7);
  assert.equal(a.body.data.total,50);
  const all=[...a.body.data.items];let cursor=a.body.data.next_cursor;
  while(cursor){const b=await req(query+'&cursor='+encodeURIComponent(cursor),'GET',undefined,admin);assert.equal(b.status,200);assert.equal(b.body.data.total,50);all.push(...b.body.data.items);cursor=b.body.data.next_cursor;}
  assert.equal(all.length,50);assert.equal(new Set(all.map(x=>x.id)).size,50);
  for(let i=1;i<all.length;i++)assert.ok(BigInt(all[i-1].ingest_order)>BigInt(all[i].ingest_order));
  assert.ok(all.every(x=>x.quality_result==='FAIL'&&[tasks[0].id,tasks[1].id].includes(x.raw_payload.task_id)));
  assert.equal((await req('/measurements?order=desc&from=2099-01-01T00:00:00Z','GET',undefined,admin)).body.data.items.length,0);
  assert.equal((await req('/measurements?from=invalid','GET',undefined,admin)).status,400);
  assert.equal((await req(query+'&to=2000-01-01T00:00:00Z&cursor='+encodeURIComponent(a.body.data.next_cursor),'GET',undefined,admin)).status,400);
  results.push('B2-identity/catalog/multi-task/descending/filter/cursor');
 });
 await t.test('two competing tasks cannot occupy the same device',async()=>{
  const original=tasks[0];const ended=await command('/tasks/'+original.id+':end',{reason:'acceptance concurrency fixture'},admin,{'If-Match':String(original.version)});assert.equal(ended.status,200);
  const input=Object.fromEntries(['work_order_id','spool_id','specification_id','process_id','device_id','metric_code','recipe_version_id','planned_length_m'].map(k=>[k,original[k]]));const a=await command('/tasks',input,admin),b=await command('/tasks',input,admin);const responses=await Promise.all([a,b].map(x=>command('/tasks/'+x.body.data.id+':start',{},admin,{'If-Match':'1'})));assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);results.push('concurrent-device-occupancy');
 });
 await t.test('network failure preserves SQLite queue; process restart drains same keys',async()=>{
  const pendingRun=sim(['run','--device','HY-JX-01','--run','offline-run','--count','40','--interval-ms','100','--drain-seconds','1','--scenario','normal']);
  for(let i=0;i<50;i++){const r=await db.query("SELECT count(*) FROM m04.measurement_record WHERE source_record_key LIKE 'offline-run-%'");if(Number(r.rows[0].count)>0)break;await wait(100);}
  await stop(api);const captured=await pendingRun;writeFileSync(resolve(evidence,'offline-capture.log'),captured.out);assert.equal(captured.code,2,captured.out);
  await startApi();const drained=await sim(['drain','--run','offline-run','--interval-ms','50']);writeFileSync(resolve(evidence,'offline-drain.log'),drained.out);assert.equal(drained.code,0,drained.out);const count=await db.query("SELECT count(*) FROM m04.measurement_record WHERE source_record_key LIKE 'offline-run-%'");assert.equal(count.rows[0].count,'40');results.push('offline-persist/restart-drain');
 });
 await t.test('factory scope hides other-factory objects and disabled identities are denied',async()=>{
  const viewerId=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[viewerId]);assert.equal((await req('/tasks/'+tasks[0].id,'GET',undefined,viewer)).status,404);assert.equal((await req('/measurements','GET',undefined,viewer)).body.data.items.length,0);await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[viewerId]);await owner.query("UPDATE m00.app_user SET status='DISABLED' WHERE id=$1",[viewerId]);assert.equal((await req('/tasks','GET',undefined,viewer)).status,401);await owner.query("UPDATE m00.app_user SET status='ACTIVE' WHERE id=$1",[viewerId]);results.push('cross-factory/disabled-user');
 });
 await t.test('API restart preserves history; stopped worker does not block ingest; logout revokes',async()=>{
  const before=(await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count;await stop(worker);assert.equal((await device('/measurements:ingest',batch([sample]))).body.data.items[0].receipt_status,'DUPLICATE');await stop(api);await startApi();assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count,before);assert.equal((await req('/tasks','GET',undefined,admin)).status,200);await req('/auth/logout','POST',{},viewer);assert.equal((await req('/tasks','GET',undefined,viewer)).status,401);results.push('restart/worker-independent/logout');
 });
 await b3Cases(t,{req,command,device,login,db,owner,sim});results.push('B3-production/plans/identity/length/queries');
 await b3r1Cases(t,{req,command,device,login,db,owner,sim});results.push('B3R1-spool-summary/scoped-history');
 await b3r2Cases(t,{req,command,device,login,db,owner,sim});results.push('B3R2-single-task-association');
 await b3r3Cases(t,{req,command,device,login,db,owner,sim});results.push('B3R3-paging/filters/summaries');
 await b3r4Cases(t,{req,command,device,login,db,owner});results.push('B3R4-workorders/activity/scope');
 await stop(api);await startApi();await ad01Cases(t,{req,command,login,db,owner});results.push('AD01-management');
 await cat01Cases(t,{req,command,login,db,owner,sim});results.push('CAT01-catalog');
 await rule01Cases(t,{req,command,login,db,owner,sim,device});results.push('RULE01-versioned-simulation-rules');
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify({database:dbName,results,records:(await db.query('SELECT count(*) FROM m04.measurement_record')).rows[0].count,frontend:'not changed/not tested',hardware:'not tested',mes:'not tested'},null,2));console.log('Evidence: '+evidence);
 }finally{await stop(worker);await stop(api);await db.end();await owner.end();writeFileSync(resolve(evidence,'api.log'),apiLog);}
});

