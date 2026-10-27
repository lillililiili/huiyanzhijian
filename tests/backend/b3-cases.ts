import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function b3Cases(t:any,h:any){
 const {req,command,device,login,db,owner,sim}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const end=async(id:string)=>{const task=ok(await req('/tasks/'+id,'GET',undefined,admin));if(task.state==='RUNNING')ok(await command('/tasks/'+id+':end',{reason:'B3 isolated acceptance'},admin,{'If-Match':String(task.version)}));};
 for(const task of (await db.query("SELECT id FROM m02.inspection_task WHERE state='RUNNING'")).rows)await end(task.id);
 const order=ok(await command('/work-orders',{external_code:'B3-PLAN-DG',specification_id:'SP035-400'},admin));
 const other=ok(await command('/work-orders',{external_code:'B3-PLAN-JX',specification_id:'SP110-800'},admin));
 const spools=[];for(let i=0;i<4;i++)spools.push(ok(await command('/spools',{work_order_id:order.id,spool_code:'B3-'+i},admin)));
 const otherSpool=ok(await command('/spools',{work_order_id:other.id,spool_code:'B3-OTHER'},admin));
 const input=(spool:any,metric='dg')=>({work_order_id:spool.work_order_id,spool_id:spool.id,specification_id:metric==='jx'?'SP110-800':'SP035-400',process_id:'process-'+metric,device_id:metric==='dg'?'HY-DG-01':metric==='jx'?'HY-JX-01':'HY-BY-01',metric_code:metric==='dg'?'SHIELD_OVERLAP_RATE':metric==='jx'?'WIRE_GAP':'OVALITY',recipe_version_id:metric==='dg'?'DG-V1.0':metric==='jx'?'JX-V1.0':'BY-V1.0',planned_length_m:'100.0000000001'});
 let plan:any;
 await t.test('B3 persistent mixed-spec plan, partial generate, retry and concurrent unique numbering',async()=>{
  const body={name:'B3 mixed plan',items:[input(spools[0]),input(spools[1]),input(otherSpool,'jx'),{...input(spools[2]),recipe_version_id:'missing-recipe'}]},key=randomUUID();
  plan=ok(await command('/plans',body,admin,{'Idempotency-Key':key}));assert.equal(ok(await command('/plans',body,admin,{'Idempotency-Key':key})).id,plan.id);
  const a=ok(await command('/plans/'+plan.id+':generate',{},admin));assert.deepEqual(a.results.map((x:any)=>x.status),['CREATED','CREATED','CREATED','FAILED']);
  const b=ok(await command('/plans/'+plan.id+':generate',{},admin));assert.deepEqual(a.results.map((x:any)=>x.task_id),b.results.map((x:any)=>x.task_id));
  const c=await Promise.all(Array.from({length:12},()=>command('/tasks',input(spools[3]),admin)));const codes=c.map(x=>ok(x).task_code);assert.equal(new Set(codes).size,12);assert.ok(codes.every(x=>/^\d{12,}$/.test(x)));
  plan=ok(await req('/plans/'+plan.id,'GET',undefined,admin));assert.equal(plan.items.length,4);
 });
 await t.test('B3 start item conflicts are recoverable; removal retains cancelled task and audit',async()=>{
  const r=ok(await command('/plans/'+plan.id+':start',{},admin));assert.equal(r.results[0].status,'RUNNING');assert.equal(r.results[1].error.code,'DEVICE_OCCUPIED');
  assert.equal(ok(await command('/plans/'+plan.id+':remove',{item_id:plan.items[0].id,reason:'not allowed'},admin)).results[0].error.code,'TASK_STATE_CONFLICT');
  await end(plan.items[0].task.id);assert.equal(ok(await command('/plans/'+plan.id+':start',{item_id:plan.items[1].id},admin)).results[0].status,'RUNNING');await end(plan.items[1].task.id);await end(plan.items[2].task.id);
  const refreshed=ok(await req('/plans/'+plan.id,'GET',undefined,admin));assert.ok(refreshed.items.slice(0,3).every((i:any)=>i.last_error===null));
  ok(await command('/plans/'+plan.id+':remove',{item_id:plan.items[3].id,reason:'invalid recipe removed'},admin));
  const p=ok(await command('/plans',{name:'Cancel plan',items:[input(spools[0])]},admin));ok(await command('/plans/'+p.id+':generate',{},admin));const detail=ok(await req('/plans/'+p.id,'GET',undefined,admin));ok(await command('/plans/'+p.id+':remove',{item_id:detail.items[0].id,reason:'schedule changed'},admin));assert.equal(ok(await req('/tasks/'+detail.items[0].task.id,'GET',undefined,admin)).state,'CANCELLED');
  assert.equal((await db.query("SELECT count(*) FROM m00.audit_event WHERE action='PLAN_ITEM_REMOVE'")).rows[0].count,'2');
 });
 const config={enabled:true,specification_id:'SP035-400',recipe_version_id:'DG-V1.0'};
 const session=async(d:string)=>ok(await device('/device-sessions',{schema_version:'1.0',device_id:d,data_environment:'SIMULATED',client_session_id:randomUUID(),producer_version:'B3-test'})).connection_id;
 let connection=await session('HY-DG-01');const event=(changes:any={})=>({schema_version:'1.0',event_id:randomUUID(),encounter_id:randomUUID(),device_id:'HY-DG-01',connection_id:connection,phase:'ENTER',occurred_at:new Date().toISOString(),meter:{counter_id:'segment',value_m:'100.1234567891'},...changes});
 let discovered:any,enter:any;
 await t.test('B3 auto disabled, version, authorization and duplicate delivery',async()=>{
  assert.equal((await device('/production-events',event())).body.code,'AUTO_DISCOVERY_DISABLED');
  assert.equal((await command('/discovery-profiles/HY-DG-01',config,viewer,{'If-Match':'0'})).status,403);
  ok(await command('/discovery-profiles/HY-DG-01',config,admin,{'If-Match':'0'}));assert.equal((await command('/discovery-profiles/HY-DG-01',config,admin,{'If-Match':'0'})).status,412);
  enter=event({material_ref:'B3-known-material'});discovered=ok(await device('/production-events',enter));assert.equal(discovered.state,'RUNNING');
  assert.equal(ok(await device('/production-events',enter)).duplicate,true);assert.equal(ok(await device('/production-events',{...enter,event_id:randomUUID()})).task_id,discovered.task_id);
  assert.equal((await device('/production-events',{...enter,meter:null})).body.code,'EVENT_PAYLOAD_CONFLICT');
  assert.equal((await device('/production-events',event())).body.code,'DEVICE_OCCUPIED');
  assert.equal((await db.query("SELECT count(*) FROM m02.inspection_task WHERE creation_source='AUTO'")).rows[0].count,'1');
 });
 await t.test('B3 automatic binding samples, reconnect retry and precise counter delta',async()=>{
  const run=await sim(['run','--device','HY-DG-01','--run','b3-auto','--count','8','--interval-ms','50','--scenario','mixed']);assert.equal(run.code,0,run.out);
  assert.equal((await db.query('SELECT count(*) FROM m04.measurement_record WHERE task_id=$1',[discovered.task_id])).rows[0].count,'8');
  connection=await session('HY-DG-01');assert.equal(ok(await device('/production-events',{...enter,connection_id:connection})).task_id,discovered.task_id);
  const exited=ok(await device('/production-events',event({encounter_id:enter.encounter_id,phase:'EXIT',meter:{counter_id:'segment',value_m:'150.1234567892'}})));assert.equal(exited.reported_length_m,'50.0000000001');assert.equal(exited.state,'ENDED');
  const detail=ok(await req('/task-details/'+discovered.task_id,'GET',undefined,admin));assert.equal(detail.measurements.total,8);assert.equal(detail.measurements.invalid,2);assert.equal(detail.encounter.encounter_id,enter.encounter_id);
 });
 await t.test('B3 same material across instruments retains a single spool and counters reset to unknown',async()=>{
  ok(await command('/discovery-profiles/HY-BY-01',{...config,recipe_version_id:'BY-V1.0'},admin,{'If-Match':'0'}));
  const conn=await session('HY-BY-01'),e=event({device_id:'HY-BY-01',connection_id:conn,material_ref:'B3-known-material'}),r=ok(await device('/production-events',e));assert.equal(r.spool_id,discovered.spool_id);assert.notEqual(r.task_id,discovered.task_id);
  const out=ok(await device('/production-events',{...e,event_id:randomUUID(),phase:'EXIT',occurred_at:new Date().toISOString(),meter:{counter_id:'new-segment',value_m:'1'}}));assert.equal(out.reported_length_m,null);assert.equal(out.length_status,'COUNTER_CHANGED');
 });
 await t.test('B3 explicit manual task wins; ambiguous manual candidates require task id',async()=>{
  const manual=ok(await command('/tasks',input(spools[2]),admin));const e=event({spool_id:spools[2].id}),r=ok(await device('/production-events',e));assert.equal(r.task_id,manual.id);assert.equal(ok(await req('/tasks/'+manual.id,'GET',undefined,admin)).creation_source,'MANUAL');
  ok(await device('/production-events',{...e,event_id:randomUUID(),phase:'EXIT',occurred_at:new Date().toISOString(),meter:null}));
  assert.equal((await device('/production-events',event({spool_id:spools[3].id}))).body.code,'TASK_SELECTION_REQUIRED');
  const candidate=(await db.query("SELECT id FROM m02.inspection_task WHERE spool_id=$1 AND state='CREATED' ORDER BY task_code LIMIT 1",[spools[3].id])).rows[0];const e2=event({task_id:candidate.id}),r2=ok(await device('/production-events',e2));assert.equal(r2.task_id,candidate.id);ok(await device('/production-events',{...e2,event_id:randomUUID(),phase:'EXIT',occurred_at:new Date().toISOString(),meter:null}));
  assert.equal((await device('/production-events',event({phase:'EXIT'}))).body.code,'ENCOUNTER_NOT_FOUND');assert.equal((await device('/production-events',event({occurred_at:'2000-01-01T00:00:00Z'}))).body.code,'EVENT_TIME_OUT_OF_RANGE');
 });
 await t.test('B3 rename and reversible grouping keep original facts; mixed specs and factory access denied',async()=>{
  const original=ok(await req('/tasks/'+discovered.task_id,'GET',undefined,admin));let spool=(await db.query('SELECT * FROM m02.cable_spool WHERE id=$1',[discovered.spool_id])).rows[0];const rename={spool_code:'B3-renamed',canonical_spool_id:null,reason:'customer spool code'};
  ok(await command('/spools/'+spool.id+':edit',rename,admin,{'If-Match':String(spool.version)}));assert.equal((await command('/spools/'+spool.id+':edit',rename,admin,{'If-Match':String(spool.version)})).status,412);
  assert.deepEqual(ok(await req('/tasks/'+discovered.task_id,'GET',undefined,admin)).context_snapshot,original.context_snapshot);
  ok(await command('/spools/'+spools[0].id+':edit',{spool_code:'B3-member',canonical_spool_id:spool.id,reason:'same physical cable verified'},admin,{'If-Match':'1'}));
  const search=ok(await req('/production/tasks?spool_id='+spool.id+'&limit=1','GET',undefined,admin));assert.equal(search.items.length,1);assert.ok(search.total>=4);assert.equal(search.spools,1);
  ok(await command('/spools/'+spools[0].id+':edit',{spool_code:'B3-member',canonical_spool_id:null,reason:'undo grouping'},admin,{'If-Match':'2'}));
  assert.equal((await command('/spools/'+otherSpool.id+':edit',{spool_code:otherSpool.spool_code,canonical_spool_id:spool.id,reason:'bad'},admin,{'If-Match':'1'})).status,422);
  const user=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[user]);
  try{assert.equal(ok(await req('/production/tasks','GET',undefined,viewer)).total,0);assert.equal((await req('/plans/'+plan.id,'GET',undefined,viewer)).status,404);assert.equal((await req('/task-details/'+discovered.task_id,'GET',undefined,viewer)).status,404);}finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[user]);}
 });
 await t.test('B3 filtered totals and pages agree; auto dates and invalid filters',async()=>{
  const a=ok(await req('/production/tasks?creation_source=AUTO&data_environment=SIMULATED&limit=1','GET',undefined,admin));const b=ok(await req('/production/tasks?creation_source=AUTO&data_environment=SIMULATED&limit=1&page=2','GET',undefined,admin));assert.equal(a.total,2);assert.equal(a.ended,2);assert.notEqual(a.items[0].id,b.items[0].id);assert.equal(ok(await req('/production/tasks?from=2099-01-01T00:00:00Z','GET',undefined,admin)).total,0);assert.equal((await req('/production/tasks?from=bad','GET',undefined,admin)).status,400);
  assert.equal((await req('/plans','POST',{name:'denied',items:[input(spools[0])]},viewer)).status,403);
  await assert.rejects(db.query('UPDATE m02.production_event SET response=\'{}\''),(e:any)=>e.code==='42501');
 });
}
