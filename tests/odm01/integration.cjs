// Isolated DB and SQLite only. Run ODM01_ROOT=<workspace> node tests/odm01/integration.cjs.
const fs=require('node:fs'),p=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process'),{randomUUID,randomBytes}=require('node:crypto'),http=require('node:http');
const root=process.env.ODM01_ROOT,work=p.resolve(__dirname,'../..'),dir=p.join(root,'runtime/odm01'),platform=p.join(work,'apps/platform'),sim=p.join(work,'tools/simulator');
const {Pool}=require(p.join(platform,'node_modules/pg'));
const local=Object.fromEntries(fs.readFileSync(p.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
const dbName='hy_odm01_'+Date.now(),urlChange=u=>{const u2=new URL(u);u2.pathname='/'+dbName;return u2.toString();};
const access={users:Object.fromEntries(JSON.parse(fs.readFileSync(p.join(platform,'config/initial-catalog.json'))).users.map(u=>[u.username,'ODM01-test-'+randomBytes(12).toString('hex')])),device_token:randomBytes(32).toString('hex')};
fs.writeFileSync(p.join(dir,'access.json'),JSON.stringify(access));
const env={...process.env,...local,DATABASE_URL:urlChange(local.DATABASE_URL),MIGRATION_DATABASE_URL:urlChange(local.MIGRATION_DATABASE_URL),CURSOR_SECRET:randomBytes(32).toString('hex'),PORT:'44792',BIND_HOST:'127.0.0.1',ACCESS_FILE:p.join(dir,'access.json'),CONTRACT_ROOT:p.join(work,'contracts'),OVALITY_EDGE_TOKEN:randomBytes(32).toString('hex'),OVALITY_INFLUX_URL:'',EDGE_SYNC_TARGETS_FILE:'',API_URL:'http://127.0.0.1:44792',DEVICE_TOKEN:access.device_token,SIM_DB:p.join(dir,'simulator-'+Date.now()+'.sqlite'),SIM_WEB_PORT:'44796',SIM_WEB_PASSWORD:'ODM01-simulator-'+randomBytes(12).toString('hex'),SIM_WEB_ROOT:p.join(sim,'web'),INSPUR_ADAPTER_ROOT:p.join(work,'adapters/inspur/http'),SIM_VENDOR_TOKEN:randomBytes(32).toString('hex'),SIM_VENDOR_BASE_URL:'http://127.0.0.1:44796'};
fs.writeFileSync(p.join(dir,'test-env.json'),JSON.stringify(env));
Object.assign(process.env,{CONTRACT_ROOT:env.CONTRACT_ROOT,INSPUR_ADAPTER_ROOT:env.INSPUR_ADAPTER_ROOT,SIM_VENDOR_BASE_URL:env.SIM_VENDOR_BASE_URL,SIM_VENDOR_TOKEN:env.SIM_VENDOR_TOKEN,DEVICE_TOKEN:env.DEVICE_TOKEN});
const {Queue}=require(p.join(sim,'dist/queue')), {DeviceClient}=require(p.join(sim,'dist/client')),{record}=require(p.join(sim,'dist/scenarios'));
const {vendorQuery,readVendorMeasurements}=require(p.join(sim,'dist/vendor-http'));
const {Collector}=require(p.join(work,'adapters/inspur/http/collector.cjs'));
const {testConfig,paths}=require(p.join(work,'adapters/inspur/http/contract.cjs'));
const base='http://127.0.0.1:44792/api/v1',wait=n=>new Promise(r=>setTimeout(r,n));let api,server,proxy,admin,queue,owner;const results=[];
async function request(path,method='GET',body,headers={}){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;}
const command=(path,body,more={})=>request(path,'POST',body,{...admin,'Idempotency-Key':randomUUID(),...more});
const dh={Authorization:'Bearer '+access.device_token};
const device=(path,body)=>request(path,body===undefined?'GET':'POST',body,dh);
function launch(cwd,args){const proc=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>output+=x);return {proc,output:()=>output};}
async function ready(run,event){for(let i=0;i<100;i++){if(run.output().includes(event))return;await wait(100);}throw Error('Service not ready: '+run.output());}
async function check(name,fn){await fn();results.push({name,passed:true});console.log('PASS '+name);}
async function main(){
 const db=new Pool({connectionString:local.MIGRATION_DATABASE_URL});await db.query('CREATE DATABASE '+dbName);await db.end();
 for(const action of ['migrate','bootstrap'])execFileSync(process.execPath,['--import','tsx','db/'+action+'.ts'],{cwd:platform,env,stdio:'pipe'});
 owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL});
 api=launch(platform,['dist/composition/main.js']);await ready(api,'API_READY');server=launch(sim,['dist/web-server.js']);await ready(server,'SIM_WEB_READY');
 const login=await request('/auth/login','POST',{username:'admin',password:access.users.admin});ok(login);admin={Cookie:login.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':login.body.data.csrf_token};
 queue=new Queue(env.SIM_DB);const client=new DeviceClient(env.API_URL,access.device_token,queue),contexts=[];
 for(const [deviceId,metric,spec,short,recipe] of [['HY-DG-01','SHIELD_OVERLAP_RATE','SP035-400','dg','DG-V1.0'],['HY-JX-01','WIRE_GAP','SP110-800','jx','JX-V1.0']]){
  const wo=ok(await command('/work-orders',{external_code:'ODM01-'+short,specification_id:spec})),spool=ok(await command('/spools',{work_order_id:wo.id,spool_code:'ODM01-'+short,specification_id:spec}));
  const task=ok(await command('/tasks',{work_order_id:wo.id,spool_id:spool.id,specification_id:spec,process_id:'process-'+short,device_id:deviceId,metric_code:metric,recipe_version_id:recipe,planned_length_m:'100'}));ok(await command('/tasks/'+task.id+':start',{}, {'If-Match':String(task.version)}));
  const assignment=ok(await device('/devices/'+deviceId+'/assignment')).assignment,session=ok(await device('/device-sessions',{schema_version:'1.0',device_id:deviceId,client_session_id:randomUUID(),data_environment:'SIMULATED',producer_version:'odm01-isolated'}));
  const capture='odm01-'+short,runId='odm01-run-'+short;
  ok(await device('/devices/'+deviceId+'/assignment-acks',{schema_version:'1.0',ack_id:randomUUID(),connection_id:session.connection_id,binding_id:assignment.binding_id,binding_version:assignment.binding_version,snapshot_hash:assignment.snapshot_hash,result:'APPLIED',effective_at:new Date().toISOString(),capture_session_id:capture,first_capture_sequence:'1',reason_code:null}));
  queue.db.prepare('INSERT INTO sim_run(id,device_id,capture_session,scenario,seed,target,assignment,created_at) VALUES(?,?,?,?,?,?,?,?)').run(runId,deviceId,capture,'mixed',0,10,JSON.stringify(assignment),new Date().toISOString());
  contexts.push({deviceId,metric,spec,short,recipe,task,assignment,capture,runId});
 }
 await wait(20);
 await check('two metrics: generated source -> real HTTP pull -> M04 -> PostgreSQL',async()=>{
  for(const c of contexts){const run=queue.run(c.runId);for(let i=1;i<=4;i++)queue.saveSample(c.runId,record(run,i));const pending=queue.pending(c.runId).map(r=>JSON.parse(r.payload));
   const response=await client.request('/measurements:ingest','BatchReceipt',{schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records:pending});
   assert.equal(response.data.counts.stored,4,JSON.stringify(response));
   const list=ok(await request('/measurements?task_id='+c.task.id+'&limit=100','GET',undefined,admin));assert.equal(list.total,4);assert.equal(ok(await request('/measurements?task_id='+c.task.id+'&quality=FAIL','GET',undefined,admin)).total,1);assert.equal(list.items.filter(r=>r.raw_payload.data_status==='INVALID').length,1);
  }
  const dbRows=(await owner.query('SELECT r.source_record_key,r.raw_payload,v.value,v.sample_storage FROM m04.measurement_record r JOIN m04.measurement_value v ON r.id=v.record_id')).rows;assert.equal(dbRows.length,8);
  for(const row of dbRows){assert.equal(row.sample_storage,'POSTGRESQL');const wire=queue.db.prepare('SELECT wire_json FROM vendor_http_sample WHERE record_id=?').get(row.source_record_key);assert.deepEqual(JSON.parse(row.raw_payload.raw.data.vendor_record_json),JSON.parse(wire.wire_json));}
 });
 await check('retry is duplicate, changed source cannot overwrite',async()=>{
  const records=queue.pending(contexts[0].runId).map(r=>JSON.parse(r.payload));const b={schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records};assert.equal((await client.request('/measurements:ingest','BatchReceipt',b)).data.counts.duplicate,4);
  const changed=structuredClone(records[0]);changed.values[0].value='99';const response=ok(await device('/measurements:ingest',{...b,batch_id:randomUUID(),records:[changed]}));assert.equal(response.items[0].error_code,'RECORD_PAYLOAD_CONFLICT');
 });
 await check('vendor endpoints enforce auth, total count and GAP/PITCH separation',async()=>{
  const c=contexts[1],times=queue.db.prepare('SELECT min(sample_ms) AS first,max(sample_ms) AS last FROM vendor_http_sample').get();const {dateText}=require(p.join(work,'adapters/inspur/http/contract.cjs'));
  const q={lineId:c.capture,startTime:dateText(times.first,480),endTime:dateText(times.last,480),page:1,limit:2,dataType:'GAP'};
  const call=(body,headers={})=>fetch(env.SIM_VENDOR_BASE_URL+paths[c.metric],{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await call(q)).status,401);const h={Authorization:'Bearer '+env.SIM_VENDOR_TOKEN,'X-Sim-Device-Id':c.deviceId};
  const page=await (await call(q,h)).json();assert.equal(page.count,4);assert.equal(page.data.length,2);assert.equal((await (await call({...q,dataType:'PITCH'},h)).json()).count,0);
  assert.equal((await (await call(q,{...h,'X-Sim-Device-Id':'HY-DG-01'})).json()).count,0);
 });
 await check('offline source retains pending queue and cannot fall back to direct push',async()=>{
  const before=queue.pending(contexts[0].runId).length;const old=process.env.SIM_VENDOR_BASE_URL;process.env.SIM_VENDOR_BASE_URL='http://127.0.0.1:1';try{await assert.rejects(()=>readVendorMeasurements(queue.db,queue.pending(contexts[0].runId).map(r=>JSON.parse(r.payload))));}finally{process.env.SIM_VENDOR_BASE_URL=old;}assert.equal(queue.pending(contexts[0].runId).length,before);
 });
 await check('old formats and OVALITY queues remain byte-for-byte unchanged',async()=>{
  const c=contexts[0],old=record(queue.run(c.runId),8);assert.deepEqual(await readVendorMeasurements(queue.db,[old]),[old]);
  const oval={...old,record_id:'ov-check',raw:{schema_version:'diameter-aux-sim.v1',data:{test_only:true}},values:[{...old.values[0],metric_code:'OVALITY'}]};queue.saveSample(c.runId,oval);assert.deepEqual(JSON.parse(queue.db.prepare('SELECT payload FROM sample WHERE record_id=?').get('ov-check').payload),oval);
 });
 // Keep the isolated services for real-browser verification; no user data or running services replaced.
 fs.writeFileSync(p.join(dir,'integration-results.json'),JSON.stringify({dbName,results,contexts},null,2));
 const staticRoot=p.join(root,'apps/web/dist');
 proxy=http.createServer((req,res)=>{if(req.url.startsWith('/api/')){const upstream=http.request('http://127.0.0.1:44792'+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1:44792',origin:'http://127.0.0.1:44792'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);return;}
  const name=decodeURIComponent(req.url.split('?')[0]);let file=p.resolve(staticRoot,'.'+name);if(!file.startsWith(staticRoot+p.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=p.join(staticRoot,'index.html');const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};res.setHeader('Content-Type',mime[p.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
 await new Promise(r=>proxy.listen(44781,'127.0.0.1',r));console.log('ODM01_BROWSER_READY frontend=44781 simulator=44796 api=44792');
}
function stop(){queue?.db.close();owner?.end();proxy?.close();api?.proc.kill();server?.proc.kill();}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{stop();process.exit();});
main().catch(e=>{console.error(e);fs.writeFileSync(p.join(dir,'integration-failure.txt'),String(e));stop();process.exitCode=1;});
