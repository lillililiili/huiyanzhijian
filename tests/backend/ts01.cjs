const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),p=require('path'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');
const root=process.env.TS01_ROOT,platform=p.resolve('.');if(!root)throw Error('TS01_ROOT required');
const {Pool}=require(p.join(platform,'node_modules/pg'));
const local=Object.fromEntries(fs.readFileSync(p.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{let i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
const cfg=JSON.parse(fs.readFileSync(p.join(root,'runtime/ts01/test-influx.json'))),access=JSON.parse(fs.readFileSync(p.join(root,'runtime/b1/access.json')));
const dbName='hy_ts01_'+Date.now(),port=process.env.TS01_TEST_PORT||'44692',change=u=>{const v=new URL(u);v.pathname='/'+dbName;return v.toString()};
const env={...process.env,...local,DATABASE_URL:change(local.DATABASE_URL),MIGRATION_DATABASE_URL:change(local.MIGRATION_DATABASE_URL),PORT:port,BIND_HOST:'127.0.0.1',ACCESS_FILE:p.join(root,'runtime/b1/access.json'),CONTRACT_ROOT:p.join(root,'contracts'),OVALITY_EDGE_TOKEN:crypto.randomBytes(32).toString('hex'),OVALITY_INFLUX_URL:'http://127.0.0.1:'+cfg.port,OVALITY_INFLUX_ORG:cfg.org,OVALITY_INFLUX_BUCKET:cfg.bucket,OVALITY_INFLUX_TOKEN:cfg.token,EDGE_SYNC_TARGETS_FILE:''};
Object.assign(process.env,env);
const {ovalityTimeseries,parseCsv}=require(p.join(platform,'dist/modules/m04-measurements/timeseries'));
const {relocateOvality,restoreOvality}=require(p.join(platform,'dist/db/relocate-ovality'));
const {digest}=require(p.join(platform,'dist/infrastructure/canonical'));
const url='http://127.0.0.1:'+port+'/api/v1',pause=n=>new Promise(r=>setTimeout(r,n)),uid=()=>crypto.randomUUID();let api,log='',admin,viewer;
async function req(path,method='GET',data,headers={}){const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;}
async function login(user){const r=await req('/auth/login','POST',{username:user,password:access.users[user]});ok(r);return {Cookie:r.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':r.body.data.csrf_token};}
const cmd=(path,data,h=admin,more={})=>req(path,'POST',data,{...h,'Idempotency-Key':uid(),...more});
const deviceHeaders={Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':env.OVALITY_EDGE_TOKEN};
const device=(path,data)=>req(path,data===undefined?'GET':'POST',data,deviceHeaders);
const batch=records=>device('/measurements:ingest',{schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records});
async function start(){api=spawn(process.execPath,['dist/composition/main.js'],{cwd:platform,env,windowsHide:true,stdio:['ignore','pipe','pipe']});api.stdout.on('data',x=>log+=x);api.stderr.on('data',x=>log+=x);for(let i=0;i<80;i++){if(log.includes('API_READY'))return;await pause(100);}throw Error('API did not start');}
test('TS01 real PG + InfluxDB + HTTP, isolated data', {timeout:240000}, async t=>{
 const adminDb=new Pool({connectionString:local.MIGRATION_DATABASE_URL});await adminDb.query('CREATE DATABASE '+dbName);await adminDb.end();
 for(const s of ['migrate','bootstrap'])execFileSync(process.execPath,['--import','tsx','db/'+s+'.ts'],{cwd:platform,env,stdio:'pipe'});
 const owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL}),runtime=new Pool({connectionString:env.DATABASE_URL});let samples=[],contexts=[];
 try{
 await start();admin=await login('admin');viewer=await login('viewer');
 assert.equal(await ovalityTimeseries.health(),'UP');
 for(const [deviceId,metric,spec,short,recipe] of [['HY-DG-01','SHIELD_OVERLAP_RATE','SP035-400','dg','DG-V1.0'],['HY-JX-01','WIRE_GAP','SP110-800','jx','JX-V1.0'],['HY-BY-01','OVALITY','SP220-1200','by','BY-V1.0']]){
  const wo=ok(await cmd('/work-orders',{external_code:'TS01-'+short,specification_id:spec}));const spool=ok(await cmd('/spools',{work_order_id:wo.id,spool_code:'TS01-'+short,specification_id:spec}));
  const task=ok(await cmd('/tasks',{work_order_id:wo.id,spool_id:spool.id,specification_id:spec,process_id:'process-'+short,device_id:deviceId,metric_code:metric,recipe_version_id:recipe,planned_length_m:'100'}));ok(await cmd('/tasks/'+task.id+':start',{},admin,{'If-Match':String(task.version)}));
  const assignment=ok(await device('/devices/'+deviceId+'/assignment')).assignment;
  const session=ok(await device('/device-sessions',{schema_version:'1.0',device_id:deviceId,client_session_id:uid(),data_environment:'SIMULATED',producer_version:'ts01-test'}));
  const capture='ts01-'+short;
  ok(await device('/devices/'+deviceId+'/assignment-acks',{schema_version:'1.0',ack_id:uid(),connection_id:session.connection_id,binding_id:assignment.binding_id,binding_version:assignment.binding_version,snapshot_hash:assignment.snapshot_hash,result:'APPLIED',effective_at:new Date().toISOString(),capture_session_id:capture,first_capture_sequence:'1',reason_code:null}));
  contexts.push({deviceId,metric,spec,short,recipe,task,assignment,capture});
 }
 const template=JSON.parse(fs.readFileSync(p.join(root,'contracts/devices/v1/examples/01-measurements.json'))).records[0];
 function sample(c,n,value='1.2345678901',valid=true){const r=structuredClone(template);Object.assign(r,{record_id:`ts01-${c.short}-${n}`,device_id:c.deviceId,task_id:c.task.id,binding_id:c.assignment.binding_id,binding_version:c.assignment.binding_version,capture_session_id:c.capture,capture_sequence:String(n),sample_time:new Date().toISOString().replace(/\d{3}Z$/,'123456Z'),recipe_version_id:c.recipe,data_status:valid?'VALID':'INVALID'});r.values=[{...r.values[0],metric_code:c.metric,value:valid?value:null,unit:c.short==='jx'?'mm':'%',data_status:r.data_status,method_id:'test-'+c.short,reason_code:valid?null:'SENSOR_INVALID'}];r.raw={schema_version:{by:'diameter-aux-sim.v1',dg:'overlap-sim.v1',jx:'wire-gap-sim.v1'}[c.short],data:{fixture:'TS01 isolated',edge_gateway:{run_id:'ts01-run'},capture_note:'comma,quote"\nnewline'}};return r;}
 // Wait beyond the frozen binding effective time, then preserve six fractional digits.
 await pause(1100);
 await t.test('three metrics: only ovality samples stored externally; same instant is not identity',async()=>{
  for(const c of contexts){const r=sample(c,1,c.short==='dg'?'12.2345678901':'1.2345678901');samples.push(r);assert.equal(ok(await batch([r])).items[0].receipt_status,'STORED');}
  const r=sample(contexts[2],2,'9.1234567890');r.sample_time=samples[2].sample_time;assert.equal(ok(await batch([r])).items[0].receipt_status,'STORED');samples.push(r);
  const invalid=sample(contexts[2],3,null,false);invalid.sample_time=samples[2].sample_time;assert.equal(ok(await batch([invalid])).items[0].receipt_status,'STORED');samples.push(invalid);
  const rows=(await owner.query('SELECT r.raw_payload,v.* FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id')).rows;
  assert.equal(rows.filter(r=>r.sample_storage==='INFLUXDB'&&r.value===null&&r.raw_payload.storage==='INFLUXDB').length,3);
  assert.equal(rows.filter(r=>r.sample_storage==='POSTGRESQL'&&r.value!==null&&r.raw_payload.raw).length,2);
  const list=ok(await req('/measurements?metric_code=OVALITY&limit=100','GET',undefined,admin));assert.equal(list.total,3);assert.equal(list.items[0].raw_payload.sample_time,samples[2].sample_time);assert.deepEqual(list.items.map(r=>r.value),['1.2345678901','9.1234567890',null]);
 });
 await t.test('duplicate, conflicting payload, sequence conflict and edge-only authorization',async()=>{
  assert.equal(ok(await batch([samples[2]])).items[0].receipt_status,'DUPLICATE');
  const changed=structuredClone(samples[2]);changed.values[0].value='2';assert.equal(ok(await batch([changed])).items[0].error_code,'RECORD_PAYLOAD_CONFLICT');
  const seq=structuredClone(samples[2]);seq.record_id='new-id-same-sequence';assert.equal(ok(await batch([seq])).items[0].error_code,'CAPTURE_SEQUENCE_CONFLICT');
  assert.equal((await req('/measurements:ingest','POST',{schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records:[samples[2]]},{Authorization:deviceHeaders.Authorization})).status,403);
 });
 await t.test('authenticated edge envelope accepts nanoseconds without widening other metric timestamps',async()=>{
  const data={schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString().replace('Z','123456Z'),records:[samples[2]]};
  assert.equal(ok(await device('/measurements:ingest',data)).items[0].receipt_status,'DUPLICATE');
  assert.equal((await device('/measurements:ingest',{...data,batch_id:uid(),records:[samples[0]]})).status,400);
 });
 await t.test('detail, frozen judgment, paging, filters, task summary and cross-factory isolation',async()=>{
  const first=ok(await req('/measurements?metric_code=OVALITY&limit=1','GET',undefined,admin));assert.equal(first.total,3);assert.ok(first.has_more);
  const next=ok(await req('/measurements?metric_code=OVALITY&limit=1&cursor='+encodeURIComponent(first.next_cursor),'GET',undefined,viewer));assert.notEqual(first.items[0].id,next.items[0].id);
  const fail=ok(await req('/measurements?metric_code=OVALITY&quality=FAIL','GET',undefined,admin));assert.equal(fail.items.length,1);assert.equal(fail.items[0].value,'9.1234567890');
  const detail=ok(await req('/measurements/'+first.items[0].id,'GET',undefined,admin));assert.equal(detail.values[0].value,'1.2345678901');assert.equal(detail.evaluations[0].rule_snapshot.comparison.upper,'8');
  const task=ok(await req('/task-details/'+contexts[2].task.id,'GET',undefined,admin));assert.equal(task.measurements.minimum,'1.2345678901');assert.equal(task.measurements.maximum,'9.1234567890');
  const refs=(await owner.query("SELECT raw_payload FROM m04.measurement_record WHERE raw_payload->>'storage'='INFLUXDB' LIMIT 1")).rows;
  await assert.rejects(ovalityTimeseries.read('other-factory',[refs[0].raw_payload]));
  await assert.rejects(runtime.query("UPDATE m04.measurement_record SET raw_payload='{}'"),e=>e.code==='42501');
 });
 await t.test('storage preserves each existing consumer quarantine-statistics policy',async()=>{
  const row=(await owner.query("SELECT id,factory_id FROM m04.measurement_record WHERE source_record_key='ts01-by-2'")).rows[0];
  const {ovalityTaskStats}=require(p.join(platform,'dist/modules/m04-measurements/storage-api'));
  await owner.query("UPDATE m04.measurement_record SET receipt_status='QUARANTINED' WHERE id=$1",[row.id]);
  try{
   const filtered=(await ovalityTaskStats(row.factory_id,[contexts[2].task.id],owner)).get(contexts[2].task.id);
   const all=(await ovalityTaskStats(row.factory_id,[contexts[2].task.id],owner,true)).get(contexts[2].task.id);
   assert.equal(filtered.max.toFixed(10),'1.2345678901');assert.equal(all.max.toFixed(10),'9.1234567890');
   assert.equal(ok(await req('/task-details/'+contexts[2].task.id,'GET',undefined,admin)).measurements.maximum,'9.1234567890');
  }finally{await owner.query("UPDATE m04.measurement_record SET receipt_status='STORED' WHERE id=$1",[row.id]);}
 });
 await t.test('old ovality relocation verified, resumable and immutable snapshots unchanged',async()=>{
  const r=sample(contexts[2],9,'2.5000000000');const old=(await owner.query("SELECT * FROM m04.measurement_record WHERE source_record_key=$1",[samples[2].record_id])).rows[0];const id=uid();
  await owner.query(`INSERT INTO m04.measurement_record(id,factory_id,device_id,source_record_key,capture_session_id,capture_sequence,task_id,binding_id,binding_version,recipe_version_id,sample_kind,sample_time,time_source,position_quality,source_type,data_environment,data_status,receipt_status,raw_payload,payload_hash,schema_version) VALUES($1,$2,$3,$4,$5,9,$6,$7,$8,$9,'NEW_SAMPLE',$10,'SIMULATOR','UNKNOWN','DEVICE','SIMULATED','VALID','STORED',$11,$12,'1.0')`,[id,old.factory_id,old.device_id,r.record_id,r.capture_session_id,old.task_id,old.binding_id,old.binding_version,old.recipe_version_id,r.sample_time,JSON.stringify(r),digest(r)]);
  await owner.query("INSERT INTO m04.measurement_value(record_id,metric_code,value,unit,data_status,source_quality_result,method_id,window_definition) VALUES($1,'OVALITY',2.5,'%','VALID','NOT_EVALUATED','test-by','{}')",[id]);
  await owner.query('INSERT INTO m04.measurement_evaluation SELECT $1,version,quality_result,reason_code,recipe_version_id,rule_snapshot,evaluated_at FROM m04.measurement_evaluation WHERE record_id=$2',[id,old.id]);
  await owner.query('INSERT INTO m04.measurement_qualification SELECT $1,version,eligibility,reason_code,created_at FROM m04.measurement_qualification WHERE record_id=$2',[id,old.id]);
  const snapshot=(await owner.query('SELECT row_to_json(e) AS j FROM m04.measurement_evaluation e ORDER BY record_id')).rows;
  assert.equal(await relocateOvality(owner),1);assert.equal(await relocateOvality(owner),0);
  assert.deepEqual((await owner.query('SELECT row_to_json(e) AS j FROM m04.measurement_evaluation e ORDER BY record_id')).rows,snapshot);
  const detail=ok(await req('/measurements/'+id,'GET',undefined,admin));assert.deepEqual(detail.raw_payload,r);assert.equal(detail.values[0].value,'2.5000000000');assert.equal(detail.payload_hash.trim(),digest(r));
 });
 await t.test('real TS outage: no false ACK/empty list; other metrics unaffected; recovery idempotent',async()=>{
  const r=sample(contexts[2],10,'5');execFileSync('docker',['stop','hy-ts01-influx-test'],{stdio:'pipe'});
  try{const res=await batch([r]);assert.equal(res.status,503);assert.equal(res.body.retryable,true);assert.equal(res.body.write_outcome,'UNKNOWN');assert.equal((await owner.query('SELECT 1 FROM m04.measurement_record WHERE source_record_key=$1',[r.record_id])).rowCount,0);
   assert.equal((await req('/measurements?metric_code=OVALITY','GET',undefined,admin)).status,503);
   assert.equal(ok(await batch([sample(contexts[0],11,'13')])).items[0].receipt_status,'STORED');assert.equal(ok(await batch([sample(contexts[1],11,'2')])).items[0].receipt_status,'STORED');
   assert.equal(ok(await req('/measurements?metric_code=WIRE_GAP','GET',undefined,admin)).items.length,2);
  }finally{execFileSync('docker',['start','hy-ts01-influx-test'],{stdio:'pipe'});}
  for(let i=0;i<40;i++){if(await ovalityTimeseries.health()==='UP')break;await pause(300);}
  assert.equal(ok(await batch([r])).items[0].receipt_status,'STORED');assert.equal(ok(await batch([r])).items[0].receipt_status,'DUPLICATE');
 });
 await t.test('PG commit failure after TS write is invisible; retry creates one committed record',async()=>{
  const r=sample(contexts[2],20,'6');
  await owner.query("CREATE FUNCTION m04.ts01_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_record_key='ts01-by-20' THEN RAISE EXCEPTION 'injected commit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ts01_fail BEFORE INSERT ON m04.measurement_record FOR EACH ROW EXECUTE FUNCTION m04.ts01_fail()");
  try{assert.equal((await batch([r])).status,503);assert.equal((await owner.query('SELECT 1 FROM m04.measurement_record WHERE source_record_key=$1',[r.record_id])).rowCount,0);}finally{await owner.query('DROP TRIGGER ts01_fail ON m04.measurement_record; DROP FUNCTION m04.ts01_fail()');}
  assert.equal(ok(await batch([r])).items[0].receipt_status,'STORED');assert.equal(ok(await batch([r])).items[0].receipt_status,'DUPLICATE');
 });
 await t.test('alarm/report consumers use actual TS values and rollback restores exact history',async()=>{
  ok(await cmd('/alarms:aggregate',{task_id:contexts[2].task.id}));
  const alarm=(await owner.query('SELECT peak_value FROM m05.alarm_event WHERE task_id=$1',[contexts[2].task.id])).rows;
  assert.ok(alarm.some(a=>Number(a.peak_value)===9.123456789));
  const report=await cmd('/reports:generate',{task_id:contexts[2].task.id});ok(report);
  const before=ok(await req('/measurements?metric_code=OVALITY&limit=100','GET',undefined,admin)).items.map(r=>({id:r.id,value:r.value,raw:r.raw_payload}));
  assert.equal(await restoreOvality(owner),6);assert.equal(await relocateOvality(owner),6);
  const after=ok(await req('/measurements?metric_code=OVALITY&limit=100','GET',undefined,admin)).items.map(r=>({id:r.id,value:r.value,raw:r.raw_payload}));assert.deepEqual(after,before);
 });
 await t.test('CSV parsing handles quoted lines without corrupting payload',()=>assert.deepEqual(parseCsv(',point,_value\r\n,x,"a,b\n""c"""\r\n'),[['','point','_value'],['','x','a,b\n"c"']]));
 fs.writeFileSync(p.join(root,'runtime/ts01/test-state.json'),JSON.stringify({dbName,port,contexts,env},null,2));
 console.log('TS01 evidence database: '+dbName);
 }finally{fs.writeFileSync(p.join(root,'runtime/ts01/api-test.log'),log);api?.kill();await owner.end();await runtime.end();}
});
