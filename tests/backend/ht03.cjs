// Explicit isolated services only. Never redirects this suite to the live platform.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID:uid}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),shared=path.resolve(root,'../..');
const {Pool}=require(path.join(root,'apps/platform/node_modules/pg'));
process.env.DATABASE_URL='postgres://hy_runtime:ht03-runtime@127.0.0.1:45093/huiyan_b1';
const db=new Pool({connectionString:'postgres://hy_migrator:ht03-isolated@127.0.0.1:45093/huiyan_b1'});
const access=JSON.parse(fs.readFileSync(path.join(shared,'runtime/b1/access.json')));
const base='http://127.0.0.1:45092/api/v1',dh={Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':'ht03-isolated-edge-token-32-characters'};
async function req(p,b,h={}){const r=await fetch(base+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...h},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;}
const label=t=>'HYT1'+t.id.replaceAll('-','').toUpperCase()+'V'+(t.association_version||'1');
test('HT03 isolated PostgreSQL + Influx + HTTP paired acquisition',{timeout:120000},async t=>{try{
 const login=await req('/auth/login',{username:'admin',password:access.users.admin});
 const ah={Cookie:login.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':ok(login).csrf_token};
 const cmd=(p,b,k=uid(),more={})=>req(p,b,{...ah,'Idempotency-Key':k,...more});
 const wo=ok(await cmd('/work-orders',{external_code:'HT03-'+Date.now(),specification_id:'SP220-1200'}));
 const spool=ok(await cmd('/spools',{work_order_id:wo.id,spool_code:'HT03双项线缆',specification_id:'SP220-1200'}));
 const body={work_order_id:wo.id,spool_id:spool.id,specification_id:'SP220-1200',process_id:'process-by',device_id:'HY-BY-01',metric_code:'OVALITY',recipe_version_id:'BY-V1.0',planned_length_m:'100'};
 let source,child,active;
 const read=async id=>(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1',[id])).rows[0];
 await t.test('creation is atomic: two independent IDs/codes, same acquisition, idempotent retry',async()=>{
  const k=uid();source=ok(await cmd('/tasks',body,k));assert.equal(source.simultaneous_tasks.length,2);child=source.simultaneous_tasks.find(x=>x.metric_code==='SHEATH_THICKNESS');
  assert.equal(child.acquisition_source_task_id,source.id);assert.notEqual(child.task_code,source.task_code);assert.equal(child.rule_snapshot.comparison,null);assert.equal(child.rule_snapshot.parameters.unit,'mm');assert.deepEqual(ok(await cmd('/tasks',body,k)),source);
 });
 const scan=(task,current)=>req('/devices/HY-BY-01/task-scan',{command_id:uid(),barcode:label(task),expected_task_id:current?.task_id||null,expected_binding_id:current?.binding_id||null},dh);
 await t.test('sheath barcode starts both tasks with a single physical binding',async()=>{
  active=ok(await scan(child)).label;assert.equal(active.task_id,source.id);assert.equal((await read(child.id)).state,'RUNNING');assert.equal((await read(source.id)).state,'RUNNING');assert.equal((await db.query('SELECT count(*)::int n FROM m02.task_device_binding WHERE task_id=ANY($1)',[[source.id,child.id]])).rows[0].n,1);
 });
 await t.test('another acquisition cannot occupy the running device',async()=>{
  const other=ok(await cmd('/tasks',body));const result=await cmd('/tasks/'+other.id+':start',{},uid(),{'If-Match':String(other.version)});assert.equal(result.status,409);assert.equal((await read(other.simultaneous_tasks[1].id)).state,'CREATED');
 });
 const session=uid(),connection=uid(),a=active.assignment;
 await db.query('UPDATE m04.device_connection SET superseded_at=now() WHERE device_id=$1 AND superseded_at IS NULL',['HY-BY-01']);
 await db.query('INSERT INTO m04.device_connection(id,factory_id,device_id,client_session_id,payload_hash) VALUES($1,$2,$3,$4,$5)',[connection,'factory-local','HY-BY-01',uid(),'0'.repeat(64)]);
 ok(await req('/devices/HY-BY-01/assignment-acks',{schema_version:'1.0',ack_id:uid(),connection_id:connection,binding_id:a.binding_id,binding_version:a.binding_version,snapshot_hash:a.snapshot_hash,result:'APPLIED',capture_session_id:session,first_capture_sequence:'1',effective_at:new Date().toISOString(),reason_code:null},dh));
 const template=JSON.parse(fs.readFileSync(path.join(root,'contracts/devices/v1/examples/02-ovality-missing.json'))).records[0];
 function sample(n,mode='valid'){
  const r=structuredClone(template),at=new Date().toISOString(),bt=new Date(Date.parse(at)-1000).toISOString();
  Object.assign(r,{record_id:uid(),device_id:'HY-BY-01',capture_session_id:session,capture_sequence:String(n),task_id:source.id,binding_id:a.binding_id,binding_version:a.binding_version,sample_time:at,recipe_version_id:a.recipe_version_id,data_status:'VALID'});
  Object.assign(r.values[0],{value:'5.1282051282',data_status:'VALID',method_id:'test-by',reason_code:null});
  r.raw.data={edge_gateway:{run_id:session},observation:{diameter_x_mm:'40',diameter_y_mm:'38'},edge_simulation:{meter:{sample_time:at,delay_ms:1000,distance_mm:200,sync_revision:'3',source:'SIMULATED',record_id:'meter-'+n},gauge_b:{values:['36','36'],sample_time:bt,status:'VALID'}},edge_sheath:{status:'TIME_COMPENSATED',method:'sheath-a-mean-minus-b-mean.meter-time.v3',aMean:'39',bMean:'36',value:'3',aAt:at,bAt:bt,targetAt:bt,delayMs:'1000',distanceMm:'200',syncRevision:'3',meterRecordId:'meter-'+n,meterSource:'SIMULATED',upstreamGauge:'B',residualMs:'0'}};
  if(mode==='missing')delete r.raw.data.edge_sheath;
  if(mode==='invalid')r.raw.data.edge_sheath.value='99';
  return r;
 }
 const records=[sample(1),sample(2,'missing'),sample(3,'invalid')];
 const ingest=rows=>req('/measurements:ingest',{schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records:rows},dh);
 await t.test('one upload writes two result streams; missing/invalid pair never becomes pass/zero',async()=>{
  const receipt=ok(await ingest(records));assert.equal(receipt.counts.stored,3,JSON.stringify(receipt));
  const rows=(await db.query('SELECT r.*,v.value,v.data_status AS validity,e.quality_result,p.sheath_result FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id JOIN m04.measurement_projection p ON p.record_id=r.id WHERE r.task_id=$1 ORDER BY r.capture_sequence',[child.id])).rows;
  assert.equal(rows.length,3);assert.equal(rows[0].value,'3.0000000000');assert.equal(rows[1].value,null);assert.equal(rows[2].value,null);assert.deepEqual(rows.map(r=>r.sheath_result.status),['VERIFIED','NOT_PROVIDED','INVALID']);assert(rows.every(r=>r.quality_result==='NOT_EVALUATED'&&r.derived_from_record_id));
  for(const r of rows){const original=(await db.query('SELECT * FROM m04.measurement_record WHERE id=$1',[r.derived_from_record_id])).rows[0];assert.equal(original.sample_time.toISOString(),r.sample_time.toISOString());assert.equal(original.task_id,source.id);}
 });
 await t.test('retransmit and concurrent duplicate do not increment either stream',async()=>{
  const result=await Promise.all([ingest(records),ingest(records)]);for(const r of result)assert.equal(ok(r).counts.duplicate,3);
  const stats=(await db.query('SELECT * FROM m04.task_statistics WHERE task_id=ANY($1)',[[source.id,child.id]])).rows;assert.equal(stats.length,2);assert(stats.every(r=>Number(r.total)===3));assert.equal(Number(stats.find(r=>r.task_id===child.id).valid),1);
 });
 await t.test('independent task filters/history and original evidence trace are real database reads',async()=>{
  const list=ok(await req('/production/tasks?work_order_id='+wo.id+'&metric_code=SHEATH_THICKNESS',undefined,ah));assert.equal(list.items.length,2);assert(list.items.every(r=>r.metric_code==='SHEATH_THICKNESS'));
  const rows=ok(await req('/measurements?task_id='+child.id,undefined,ah));assert.equal(rows.total,3);assert(rows.items.every(r=>r.raw_payload.task_id===child.id&&r.metric_code==='SHEATH_THICKNESS'&&r.unit==='mm'));assert(rows.items.every(r=>r.raw_payload.derived_from_record_id));
 });
 await t.test('failed companion insert rolls back primary metadata and retry repairs both',async()=>{
  const r=sample(4);
  await db.query(`CREATE OR REPLACE FUNCTION public.ht03_fail_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.derived_from_record_id IS NOT NULL THEN RAISE EXCEPTION 'HT03 isolated failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ht03_fail_child BEFORE INSERT ON m04.measurement_record FOR EACH ROW EXECUTE FUNCTION public.ht03_fail_child()`);
  try{assert.equal((await ingest([r])).status,503);assert.equal((await db.query('SELECT count(*)::int n FROM m04.measurement_record WHERE source_record_key=$1',[r.record_id])).rows[0].n,0);}
  finally{await db.query('DROP TRIGGER ht03_fail_child ON m04.measurement_record; DROP FUNCTION public.ht03_fail_child()');}
  assert.equal(ok(await ingest([r])).counts.stored,1);assert.equal((await db.query('SELECT count(*)::int n FROM m04.measurement_record WHERE task_id=$1',[child.id])).rows[0].n,4);
 });
 await t.test('independent sheath manual import is rejected without shared raw acquisition',async()=>{assert.equal((await cmd('/measurements/import:parse',{task_id:child.id,rows:[{value:3,position_m:1}]})).body.code,'SHEATH_SHARED_ACQUISITION');});
 await t.test('switching/repeated scans closes both old tasks and creates a fresh pair',async()=>{
  const next=ok(await scan(child,active)).label;assert.notEqual(next.task_id,source.id);const partner=(await db.query('SELECT * FROM m02.inspection_task WHERE acquisition_source_task_id=$1',[next.task_id])).rows[0];assert.equal(partner.state,'RUNNING');assert.equal((await read(child.id)).state,'ENDED');assert.equal((await read(source.id)).state,'ENDED');
  ok(await req('/devices/HY-BY-01/task-stop',{command_id:uid(),expected_task_id:next.task_id,expected_binding_id:next.binding_id},dh));assert.equal((await read(partner.id)).state,'ENDED');
 });
 await t.test('plan generation exposes two tasks and cancellation closes both',async()=>{
  const plan=ok(await cmd('/plans',{name:'HT03 paired plan',items:[body]}));ok(await cmd('/plans/'+plan.id+':generate',{}));
  const result=ok(await req('/plans/'+plan.id,undefined,ah)),item=result.items[0];assert.equal(item.task.simultaneous_tasks.length,1);
  const sibling=item.task.simultaneous_tasks[0];assert.equal(sibling.metric_code,'SHEATH_THICKNESS');
  ok(await cmd('/plans/'+plan.id+':remove',{item_id:item.id,reason:'HT03 isolated cancellation'}));assert.equal((await read(sibling.id)).state,'CANCELLED');assert.equal((await scan(sibling)).status,409);
 });
 await t.test('association correction moves only this acquisition pair and invalidates old labels',async()=>{
  const target=ok(await cmd('/spools',{work_order_id:wo.id,spool_code:'HT03 corrected spool',specification_id:'SP220-1200'}));
  const before=await read(child.id);ok(await cmd('/tasks/'+child.id+':reassociate',{target_spool_id:target.id,target_spool_version:String(target.version),reason:'HT03 paired association'},uid(),{'If-Match':String(before.version)}));
  assert.equal((await read(source.id)).spool_id,target.id);assert.equal((await read(child.id)).spool_id,target.id);
  assert.equal((await scan(child)).body.code,'LABEL_SUPERSEDED');
  const changes=(await db.query('SELECT * FROM m02.task_association_change WHERE task_id=ANY($1)',[[source.id,child.id]])).rows;assert.equal(changes.length,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM m04.measurement_record WHERE task_id=$1',[child.id])).rows[0].n,4);
 });
 await t.test('sheath report freezes millimetre results without inventing a quality verdict',async()=>{
  const r=ok(await cmd('/reports:generate',{task_id:child.id,report_kind:'TASK_FINAL'}));const detail=ok(await req('/reports/'+r.id,undefined,ah));
  assert.equal(detail.final_result,'NOT_EVALUATED');assert.equal(detail.coverage_snapshot.valid_records,2);assert.equal(detail.statistics.SHEATH_THICKNESS.verdict,'NOT_EVALUATED');assert.equal(detail.statistics.SHEATH_THICKNESS.compliance_rate,null);assert.equal(detail.statistics.SHEATH_THICKNESS.unit,'mm');assert.equal(detail.statistics.SHEATH_THICKNESS.total_samples,4);assert.equal(detail.statistics.SHEATH_THICKNESS.valid_samples,2);
 });
 await t.test('append-only historical backfill is restartable, preserves original hashes, then does zero work',async()=>{
  const {backfillSheathTasks}=require(path.join(root,'apps/platform/dist/db/backfill-sheath-tasks'));
  // Remove only a new, empty companion in this isolated fixture to emulate a pre-HT03 task.
  const legacy=ok(await cmd('/tasks',body));await db.query('DELETE FROM m02.inspection_task WHERE id=$1',[legacy.simultaneous_tasks[1].id]);
  const before=(await db.query('SELECT id,payload_hash FROM m04.measurement_record WHERE derived_from_record_id IS NULL ORDER BY id')).rows;
  assert.equal((await backfillSheathTasks(db)).created,1);assert.deepEqual(await backfillSheathTasks(db),{created:0,derived:0});
  assert.deepEqual((await db.query('SELECT id,payload_hash FROM m04.measurement_record WHERE derived_from_record_id IS NULL ORDER BY id')).rows,before);
 });
 await t.test('readonly/anonymous/cross-factory cannot create or observe pair',async()=>{
  const v=await req('/auth/login',{username:'viewer',password:access.users.viewer});const vh={Cookie:v.cookies.map(c=>c.split(';')[0]).join('; '),'X-CSRF-Token':ok(v).csrf_token,'Idempotency-Key':uid()};assert.equal((await req('/tasks',body,vh)).status,403);assert.equal((await req('/tasks',body)).status,401);
  const {TaskApi}=require(path.join(root,'apps/platform/dist/modules/m02-tasks/api'));const api=new TaskApi({}, {}, {});
  await assert.rejects(()=>api.get({factory:'other-factory'},child.id),e=>e.code==='RESOURCE_NOT_FOUND');
 });
 fs.mkdirSync(path.join(root,'runtime/ht03'),{recursive:true});fs.writeFileSync(path.join(root,'runtime/ht03/fixture.json'),JSON.stringify({wo,source,child,spool}));
}finally{await db.end();await require(path.join(root,'apps/platform/dist/infrastructure/db')).pool.end();}});

