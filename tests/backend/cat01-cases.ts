import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function cat01Cases(t:any,h:any){
 const {req,command,login,db,owner,sim}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const read=async(path:string,who=admin)=>ok(await req(path,'GET',undefined,who));
 ok(await command('/auth/factory',{factory_id:'factory-local'},admin));
 const body={code:'CAT01-API',name:'CAT01规格',voltage_kv:'35',conductor_area_mm2:'400.125',core_count:1,shield_structure:'tape',enabled:true,cable_model:'YJLW',customer_code:'TEST',product_type:'验收',description:'隔离模拟验收',reason:'CAT01验收',applicability:[{process_id:'process-dg',metric_code:'SHIELD_OVERLAP_RATE'}]};
 let spec:any,task:any;
 await t.test('CAT01 creates persistent catalog, retries idempotently and paginates literally',async()=>{
  const key=randomUUID();spec=ok(await command('/catalog/specifications',body,admin,{'Idempotency-Key':key}));
  assert.notEqual(spec.id,spec.code);assert.equal(ok(await command('/catalog/specifications',body,admin,{'Idempotency-Key':key})).id,spec.id);
  assert.equal((await command('/catalog/specifications',{...body,name:'other'},admin,{'Idempotency-Key':key})).status,409);
  assert.equal((await command('/catalog/specifications',body,admin)).status,409);
  assert.equal((await db.query('SELECT name FROM m01.product_specification WHERE id=$1',[spec.id])).rows[0].name,body.name);
  assert.equal((await read('/catalog/specifications?q=CAT01-API')).total,1);
  assert.equal((await read('/catalog/specifications?q=%25')).total,0);
  const first=await read('/catalog/specifications?limit=2'),second=await read('/catalog/specifications?limit=2&page=2');assert.equal(first.items.length,2);assert.ok(!first.items.some((a:any)=>second.items.some((b:any)=>a.id===b.id)));
 });
 await t.test('CAT01 rejects invalid fields, incompatible structure and unauthorized scope',async()=>{
  assert.equal((await command('/catalog/specifications',body,viewer)).status,403);
  assert.equal((await req('/catalog/specifications')).status,401);
  for(const change of [{voltage_kv:'221'},{conductor_area_mm2:'0'},{core_count:1.2},{shield_structure:'wire'},{applicability:[]},{code:' bad '},{voltage_kv:'35.0001'}])assert.ok((await command('/catalog/specifications',{...body,...change},admin)).status>=400);
  assert.equal((await command('/catalog/specifications',{...body,applicability:[{process_id:'foreign',metric_code:'OVALITY'}]},admin)).status,404);
  const actorId=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;await owner.query("UPDATE m00.user_role SET factory_id='other-catalog' WHERE user_id=$1",[actorId]);
  assert.equal((await req('/catalog/specifications/'+spec.id,'GET',undefined,viewer)).status,404);assert.equal((await read('/catalog/specifications',viewer)).total,0);
  await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[actorId]);
 });
 await t.test('CAT01 new specification flows through work order, task and simulator into database',async()=>{
  const running=(await read('/tasks?limit=100')).items.filter((x:any)=>x.device_id==='HY-DG-01'&&x.state==='RUNNING');for(const x of running)ok(await command('/tasks/'+x.id+':end',{reason:'隔离测试切换'},admin,{'If-Match':String(x.version)}));
  const order=ok(await command('/work-orders',{external_code:'CAT01-SIM',specification_id:spec.id},admin)),spool=ok(await command('/spools',{work_order_id:order.id,spool_code:'CAT01-SPOOL'},admin));
  task=ok(await command('/tasks',{work_order_id:order.id,spool_id:spool.id,specification_id:spec.id,process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:null,planned_length_m:'100'},admin));
  assert.equal(task.context_snapshot.specification.version,'1');
  task=ok(await command('/tasks/'+task.id+':start',{},admin,{'If-Match':task.version}));
  const result=await sim(['run','--device','HY-DG-01','--run','cat01-new-spec','--count','8','--interval-ms','50','--scenario','mixed']);assert.equal(result.code,0,result.out);
  const history=await read('/measurements?task_id='+task.id);assert.equal(history.items.length,8);assert.ok(history.items.every((r:any)=>r.quality_result==='NOT_EVALUATED'&&r.raw_payload.data_environment==='SIMULATED'));
  assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record WHERE task_id=$1',[task.id])).rows[0].count,'8');
 });
 await t.test('CAT01 concurrent edits conflict, revision is immutable and running snapshot stays unchanged',async()=>{
  const results=await Promise.all(['甲','乙'].map(name=>command('/catalog/specifications/'+spec.id,{...body,name},admin,{'If-Match':'1'})));assert.deepEqual(results.map(r=>r.status).sort(),[200,412]);
  spec=await read('/catalog/specifications/'+spec.id);assert.equal(spec.version,'2');
  assert.equal((await read('/tasks/'+task.id)).context_snapshot.specification.name,body.name);
  const revisions=await read('/catalog/revisions/specifications/'+spec.id);assert.equal(revisions.total,2);assert.equal(revisions.items[0].snapshot.name,spec.name);
  await assert.rejects(db.query("UPDATE m01.catalog_revision SET reason='tamper'"),(e:any)=>e.code==='42501');
  assert.equal((await command('/catalog/specifications/'+spec.id,body,admin)).status,428);
 });
 await t.test('CAT01 disabled spec blocks new work and start, preserves existing running/history',async()=>{
  const input=Object.fromEntries(Object.keys(body).map(k=>[k,k==='reason'?'停用验收':spec[k]]));
  const pending=ok(await command('/tasks',{work_order_id:task.work_order_id,spool_id:task.spool_id,specification_id:spec.id,process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:null,planned_length_m:'100'},admin));
  spec=ok(await command('/catalog/specifications/'+spec.id,{...input,enabled:false},admin,{'If-Match':spec.version}));
  assert.equal((await read('/catalog/specifications?enabled=false&q=CAT01')).total,1);
  assert.equal((await command('/work-orders',{external_code:'CAT01-disabled',specification_id:spec.id},admin)).status,422);
  assert.equal((await command('/tasks/'+pending.id+':start',{},admin,{'If-Match':pending.version})).status,422);
  assert.equal((await read('/tasks/'+task.id)).state,'RUNNING');assert.equal((await read('/measurements?task_id='+task.id)).items.length,8);
  ok(await command('/tasks/'+task.id+':end',{reason:'CAT01隔离测试完成'},admin,{'If-Match':task.version}));
 });
 await t.test('CAT01 device metadata changes preserve protocol, environment and history',async()=>{
  const d=(await read('/catalog')).device.find((x:any)=>x.id==='HY-DG-01');const b={name:d.name,model:d.model,manufacturer:'模拟器',serial_number:'CAT01-001',firmware:'test.v1',notes:'仅模拟联调',reason:'设备资料验收'};
  const saved=ok(await command('/catalog/devices/'+d.id,b,admin,{'If-Match':d.version}));assert.equal(saved.data_environment,d.data_environment);assert.equal(saved.capability_version,d.capability_version);assert.equal(saved.serial_number,'CAT01-001');
  assert.equal((await command('/catalog/devices/'+d.id,{...b,data_environment:'REAL'},admin,{'If-Match':saved.version})).status,400);
  assert.equal((await command('/catalog/devices/'+d.id,b,viewer,{'If-Match':saved.version})).status,403);
  assert.equal((await command('/catalog/devices/'+d.id,b,admin,{'If-Match':d.version})).status,412);
  assert.equal((await read('/catalog/revisions/devices/'+d.id)).total,2);
  const audit=await read('/admin/audits?resource_id='+d.id+'&action=CATALOG_UPDATED');assert.equal(audit.total,1);assert.equal(audit.items[0].details.after.serial_number,'CAT01-001');
 });
}
