import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function b3r2Cases(t:any,h:any){
 const {req,command,device,login,db,owner,sim}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const wo=ok(await command('/work-orders',{external_code:'B3R2-A',specification_id:'SP035-400'},admin));
 const other=ok(await command('/work-orders',{external_code:'B3R2-B',specification_id:'SP035-400'},admin));
 const a=ok(await command('/spools',{work_order_id:wo.id,spool_code:'B3R2-A'},admin));
 const b=ok(await command('/spools',{work_order_id:other.id,spool_code:'B3R2-B'},admin));
 const input={work_order_id:wo.id,spool_id:a.id,specification_id:'SP035-400',process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:'DG-V1.0',planned_length_m:'100'};
 const t1=ok(await command('/tasks',input,admin)),t2=ok(await command('/tasks',input,admin));
 const get=async()=>ok(await req('/tasks/'+t2.id,'GET',undefined,admin));
 const payload=(target=b)=>({target_spool_id:target.id,target_spool_version:String(target.version),reason:'人工核对，单任务误挂更正'});
 const correct=async(body=payload(),headers=admin,extra:any={})=>command('/tasks/'+t2.id+':reassociate',body,headers,{'If-Match':String((await get()).version),...extra});
 await t.test('B3R2 role, reason, version, same-spool and running state guards',async()=>{
  assert.equal((await correct(payload(),viewer)).status,403);
  assert.equal((await device('/tasks/'+t2.id+':reassociate',payload())).status,403);
  assert.equal((await correct({...payload(),reason:'  '})).status,400);
  assert.equal((await correct(payload(),admin,{'If-Match':''})).status,428);
  assert.equal((await correct(payload(),admin,{'If-Match':'999'})).status,412);
  assert.equal((await correct({...payload(),target_spool_version:'999'})).status,412);
  assert.equal((await correct(payload(a))).status,422);
  ok(await command('/tasks/'+t2.id+':start',{},admin,{'If-Match':String(t2.version)}));
  assert.equal((await correct()).status,409);
 });
 const run=await sim(['run','--device','HY-DG-01','--run','b3r2-origin','--count','8','--interval-ms','50','--scenario','mixed']);assert.equal(run.code,0,run.out);
 ok(await command('/tasks/'+t2.id+':end',{reason:'B3R2 fixture finished'},admin,{'If-Match':String((await get()).version)}));
 const facts=async()=>({records:(await db.query('SELECT * FROM m04.measurement_record WHERE task_id=$1 ORDER BY id',[t2.id])).rows,bindings:(await db.query('SELECT * FROM m02.task_device_binding WHERE task_id=$1 ORDER BY id',[t2.id])).rows});
 const original=await facts(),beforeTask=await get();
 const path='/measurements?spool_id='+a.id+'&limit=2',oldPage=ok(await req(path,'GET',undefined,admin));
 const key=randomUUID(),body=payload(),headers={'If-Match':String(beforeTask.version),'Idempotency-Key':key};
 await t.test('B3R2 one task moves across orders atomically; other task, raw facts and snapshots unchanged',async()=>{
  const result=ok(await command('/tasks/'+t2.id+':reassociate',body,admin,headers));
  assert.equal(result.task.spool_id,b.id);assert.equal(result.task.work_order_id,other.id);assert.equal(result.task.original_spool_id,a.id);assert.equal(result.task.original_work_order_id,wo.id);assert.equal(result.task.association_version,'2');
  assert.deepEqual(result.task.context_snapshot,beforeTask.context_snapshot);assert.deepEqual(await facts(),original);
  assert.deepEqual(ok(await req('/tasks/'+t1.id,'GET',undefined,admin)),t1);
  assert.deepEqual(ok(await req('/spool-summaries/'+a.id,'GET',undefined,admin)).tasks.map((t:any)=>t.id),[t1.id]);
  assert.equal(ok(await req('/spool-summaries/'+b.id,'GET',undefined,admin)).measurements[0].total,8);
  assert.equal(ok(await req('/measurements?spool_id='+a.id,'GET',undefined,admin)).items.length,0);
  const records=ok(await req('/measurements?spool_id='+b.id,'GET',undefined,admin)).items;assert.equal(records.length,8);assert.equal(records[0].business_context.spool_id,b.id);assert.equal(records[0].business_context.original_spool_id,a.id);assert.equal(records[0].raw_payload.task_id,t2.id);
  assert.equal(ok(await req('/production/tasks?spool_id='+b.id,'GET',undefined,admin)).items[0].id,t2.id);
  assert.equal((await req(path+'&cursor='+encodeURIComponent(oldPage.next_cursor),'GET',undefined,admin)).status,400);
  assert.equal(oldPage.items[0].business_context.spool_id,a.id);
 });
 await t.test('B3R2 retries yield one append-only audit; stale and conflicting requests rejected',async()=>{
  const replay=ok(await command('/tasks/'+t2.id+':reassociate',body,admin,headers));assert.equal(replay.task.association_version,'2');
  assert.equal((await command('/tasks/'+t2.id+':reassociate',{...body,reason:'changed'},admin,headers)).status,409);
  assert.equal((await command('/tasks/'+t2.id+':reassociate',payload(a),admin,{'If-Match':String(beforeTask.version)})).status,412);
  const history=ok(await req('/task-associations/'+t2.id,'GET',undefined,viewer));assert.equal(history.changes.length,1);assert.equal(history.changes[0].reason,body.reason);assert.equal(history.changes[0].before_context.spool_id,a.id);assert.equal(history.changes[0].after_context.spool_id,b.id);assert.ok(history.changes[0].actor_id&&history.changes[0].request_id);
  assert.equal((await db.query("SELECT count(*) FROM m00.audit_event WHERE resource_id=$1 AND action='TASK_REASSOCIATED'",[t2.id])).rows[0].count,'1');
  await assert.rejects(db.query("UPDATE m02.task_association_change SET reason='erase' WHERE task_id=$1",[t2.id]),(e:any)=>e.code==='42501');
  await assert.rejects(db.query('DELETE FROM m02.task_association_change WHERE task_id=$1',[t2.id]),(e:any)=>e.code==='42501');
  await assert.rejects(db.query('UPDATE m02.inspection_task SET original_spool_id=$2 WHERE id=$1',[t2.id,b.id]),/immutable/);
  await assert.rejects(db.query("UPDATE m02.inspection_task SET context_snapshot='{}' WHERE id=$1",[t2.id]),/immutable/);
 });
 await t.test('B3R2 late original-binding sample follows corrected business scope without changing raw identity',async()=>{
  const raw=original.records[0].raw_payload,late={...raw,record_id:randomUUID(),capture_sequence:'9999901'};
  const result=ok(await device('/measurements:ingest',{schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records:[late]}));assert.equal(result.items[0].receipt_status,'STORED');
  const current=ok(await req('/measurements?spool_id='+b.id,'GET',undefined,admin));assert.equal(current.items.length,9);assert.deepEqual(current.items.find((r:any)=>r.raw_payload.record_id===late.record_id).raw_payload,late);
  assert.equal(ok(await req('/measurements?spool_id='+a.id,'GET',undefined,admin)).items.length,0);
 });
 await t.test('B3R2 guards target factory/spec/group/source and pending encounter without side effects',async()=>{
  assert.equal((await correct({...payload(),target_spool_id:'missing-target'})).status,404);
  const diff=(await db.query('SELECT s.* FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE w.specification_id<>$1 LIMIT 1',[t2.specification_id])).rows[0];assert.equal((await correct(payload(diff))).status,422);
  const grouped=ok(await command('/spools',{work_order_id:other.id,spool_code:'B3R2-grouped'},admin));const grouped2=ok(await command('/spools/'+grouped.id+':edit',{spool_code:grouped.spool_code,canonical_spool_id:b.id,reason:'fixture'},admin,{'If-Match':String(grouped.version)}));assert.equal((await correct(payload(grouped2))).status,409);
  const real=ok(await command('/spools',{work_order_id:other.id,spool_code:'B3R2-real'},admin));
  await owner.query(`INSERT INTO m02.inspection_task(id,factory_id,task_code,work_order_id,spool_id,device_id,process_id,specification_id,metric_code,planned_length_m,data_environment,state,rule_snapshot,context_snapshot) SELECT 'b3r2-real',factory_id,'B3R2-REAL',$2,$3,device_id,process_id,specification_id,metric_code,planned_length_m,'REAL','CREATED',rule_snapshot,context_snapshot FROM m02.inspection_task WHERE id=$1`,[t2.id,other.id,real.id]);
  assert.equal((await correct(payload(real))).status,403);
  await owner.query("INSERT INTO m02.production_encounter(factory_id,device_id,encounter_id,task_id,enter_payload) VALUES('factory-local','HY-DG-01','b3r2-open',$1,'{}')",[t2.id]);
  try{assert.equal((await correct(payload(a))).body.code,'TASK_ENCOUNTER_OPEN');}finally{await owner.query('DELETE FROM m02.production_encounter WHERE task_id=$1',[t2.id]);}
  const uid=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;
  await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[uid]);try{assert.equal((await req('/task-associations/'+t2.id,'GET',undefined,viewer)).status,404);}finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[uid]);}
  assert.equal((await get()).association_version,'2');
 });
 await t.test('B3R2 competing corrections commit once; move-back remains in history and invalidates old cursors',async()=>{
  const v=String((await get()).version),responses=await Promise.all([1,2].map(()=>command('/tasks/'+t2.id+':reassociate',payload(a),admin,{'If-Match':v})));assert.deepEqual(responses.map(x=>x.status).sort(),[200,412]);
  assert.equal((await req(path+'&cursor='+encodeURIComponent(oldPage.next_cursor),'GET',undefined,admin)).status,400);
  const history=ok(await req('/task-associations/'+t2.id,'GET',undefined,admin));assert.equal(history.changes.length,2);assert.equal(history.task.spool_id,a.id);assert.equal(history.task.original_spool_id,a.id);assert.equal(history.task.association_version,'3');
 });
 await t.test('B3R2 unstarted plan task corrects current ownership while preserving plan request and new binding uses target',async()=>{
  const plan=ok(await command('/plans',{name:'B3R2-plan',items:[input]},admin));ok(await command('/plans/'+plan.id+':generate',{},admin));
  const detail=ok(await req('/plans/'+plan.id,'GET',undefined,admin)),task=detail.items[0].task;
  const updated=ok(await command('/tasks/'+task.id+':reassociate',payload(),admin,{'If-Match':String(task.version)})).task;
  const after=ok(await req('/plans/'+plan.id,'GET',undefined,admin));assert.deepEqual(after.items[0].request,detail.items[0].request);assert.equal(after.items[0].task.spool_id,b.id);
  ok(await command('/tasks/'+task.id+':start',{},admin,{'If-Match':String(updated.version)}));const assignment=ok(await device('/devices/HY-DG-01/assignment')).assignment;assert.equal(assignment.spool_id,b.id);
  const active=ok(await req('/tasks/'+task.id,'GET',undefined,admin));ok(await command('/tasks/'+task.id+':end',{reason:'fixture'},admin,{'If-Match':String(active.version)}));
 });
}
