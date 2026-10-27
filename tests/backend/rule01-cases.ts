import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RuleApi} from '../../apps/platform/modules/m03-rules/api';
export async function rule01Cases(t:any,h:any){
 const {req,command,login,db,owner,sim,device}=h,admin=await login('admin'),viewer=await login('viewer');
 const base={code:'RULE01-BY',name:'隔离测试不圆度',metric_code:'OVALITY',unit:'%',comparison:{operator:'LE',lower:null,upper:'8'},specification_ids:['SP035-300'],standard_reference:'宏亮应用方案：8%仅模拟参考',reason:'RULE01隔离验证'};
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 ok(await command('/auth/factory',{factory_id:'factory-local'},admin));
 let v1:any,v2:any,task:any,input:any;
 await t.test('RULE01 three metrics persist, idempotency and permission guard',async()=>{
  assert.equal((await command('/recipes',base,viewer)).status,403);
  assert.equal((await req('/recipes','POST',base,{Cookie:admin.Cookie})).status,403);
  const key=randomUUID();v1=ok(await command('/recipes',base,admin,{'Idempotency-Key':key}));
  assert.equal(ok(await command('/recipes',base,admin,{'Idempotency-Key':key})).id,v1.id);
  assert.equal((await command('/recipes',{...base,name:'changed'},admin,{'Idempotency-Key':key})).status,409);
  assert.equal((await command('/recipes',base,admin)).status,409);
  for(const [code,metric,unit,c] of [['RULE01-DG','SHIELD_OVERLAP_RATE','%',{operator:'BETWEEN',lower:'10',upper:'20'}],['RULE01-JX','WIRE_GAP','mm',{operator:'LE',lower:null,upper:'3'}]] as any[]){const r=ok(await command('/recipes',{...base,code,metric_code:metric,unit,comparison:c,specification_ids:[]},admin));assert.equal(r.approval_state,'TEST_ONLY');assert.equal(r.unit,unit);}
  assert.equal((await db.query('SELECT count(*) FROM m03.recipe_metadata WHERE code LIKE \'RULE01-%\'')).rows[0].count,'3');
 });
 await t.test('RULE01 invalid unit, empty/nondecimal/percentage/bounds/scope rejected',async()=>{
  for(const patch of [{unit:'mm'},{comparison:{operator:'LE',upper:'',lower:null}},{comparison:{operator:'LE',upper:'101',lower:null}},{comparison:{operator:'LE',upper:'1e2',lower:null}},{comparison:{operator:'BETWEEN',upper:'2',lower:'3'}},{comparison:{operator:'LE',upper:'8',lower:'0'}},{standard_reference:''},{specification_ids:['missing-spec']}])assert.ok((await command('/recipes',{...base,code:randomUUID(),...patch},admin)).status>=400);
  assert.equal((await command('/recipes',{...base,code:randomUUID(),metric_code:'WIRE_GAP',unit:'mm'},admin)).status,422);
 });
 await t.test('RULE01 decimal boundary, range and invalid data remain unevaluated',()=>{
  const api=new RuleApi();for(const [comparison,values] of [[{operator:'GE',lower:'10',upper:null},[['9.9999999999','FAIL'],['10','PASS']]],[{operator:'LE',lower:null,upper:'3'},[['3','PASS'],['3.0000000001','FAIL']]],[{operator:'BETWEEN',lower:'1',upper:'8'},[['0.9999999999','FAIL'],['1','PASS'],['8','PASS'],['8.0000000001','FAIL']]]] as any[]){for(const [value,result] of values)assert.equal(api.evaluate({value,data_status:'VALID',method_id:'test-by'},{...v1.rule_snapshot,comparison},'SIMULATED').quality_result,result);}
  assert.equal(api.evaluate({value:null,data_status:'INVALID'},v1.rule_snapshot,'SIMULATED').quality_result,'NOT_EVALUATED');
  assert.equal(api.evaluate({value:'8',data_status:'VALID',method_id:'test-by'},v1.rule_snapshot,'REAL').quality_result,'NOT_EVALUATED');
 });
 await t.test('RULE01 task and discovery enforce scope and preserve frozen version',async()=>{
  const wo=ok(await command('/work-orders',{external_code:'RULE01-WO',specification_id:'SP035-300'},admin));const spool=ok(await command('/spools',{work_order_id:wo.id,spool_code:'RULE01-DRUM'},admin));
  input={work_order_id:wo.id,spool_id:spool.id,specification_id:'SP035-300',device_id:'HY-BY-01',process_id:'process-by',metric_code:'OVALITY',recipe_version_id:v1.id,planned_length_m:'100'};
  task=ok(await command('/tasks',input,admin));assert.equal(task.rule_snapshot.comparison.upper,'8');
  const p=ok(await req('/discovery-profiles','GET',undefined,admin)).find((p:any)=>p.device_id==='HY-BY-01');
  assert.equal((await command('/discovery-profiles/HY-BY-01',{enabled:true,specification_id:'SP035-400',recipe_version_id:v1.id},admin,{'If-Match':String(p?.version||0)})).status,422);
  ok(await command('/discovery-profiles/HY-BY-01',{enabled:true,specification_id:'SP035-300',recipe_version_id:v1.id},admin,{'If-Match':String(p?.version||0)}));
 });
 await t.test('RULE01 edit appends version, optimistic concurrency and disabled guards',async()=>{
  const body={...base,comparison:{operator:'LE',lower:null,upper:'7'}};
  const key=randomUUID();v2=ok(await command(`/recipes/${v1.id}/versions`,body,admin,{'If-Match':'1','Idempotency-Key':key}));
  assert.equal(v2.revision,'V2.0');assert.equal(ok(await command(`/recipes/${v1.id}/versions`,body,admin,{'If-Match':'1','Idempotency-Key':key})).id,v2.id);
  assert.equal((await command(`/recipes/${v1.id}/versions`,body,admin,{'If-Match':'1'})).status,412);
  assert.equal((await command('/tasks',input,admin)).status,422);
  const p=ok(await req('/discovery-profiles','GET',undefined,admin)).find((p:any)=>p.device_id==='HY-BY-01');
  assert.equal((await command('/discovery-profiles/HY-BY-01',{enabled:true,specification_id:'SP035-300',recipe_version_id:v1.id},admin,{'If-Match':String(p.version)})).status,422);
  assert.equal(ok(await req('/tasks/'+task.id,'GET',undefined,admin)).rule_snapshot.comparison.upper,'8');
  assert.equal(ok(await command('/tasks',{...input,recipe_version_id:v2.id},admin)).rule_snapshot.comparison.upper,'7');
  await assert.rejects(db.query('UPDATE m03.recipe_version SET revision=\'tampered\' WHERE id=$1',[v1.id]),(e:any)=>e.code==='42501');
  await assert.rejects(db.query('UPDATE m03.recipe_metadata SET name=\'tampered\' WHERE recipe_version_id=$1',[v1.id]),(e:any)=>e.code==='42501');
 });
 await t.test('RULE01 existing task starts after disable; real simulated samples retain old threshold',async()=>{
  const running=(await db.query("SELECT id,version FROM m02.inspection_task WHERE device_id='HY-BY-01' AND state='RUNNING'")).rows;
  for(const r of running)ok(await command('/tasks/'+r.id+':end',{reason:'RULE01隔离测试设备释放'},admin,{'If-Match':String(r.version)}));
  const started=ok(await command('/tasks/'+task.id+':start',{},admin,{'If-Match':'1'}));assert.equal(started.rule_snapshot.comparison.upper,'8');
  const result=await sim(['run','--device','HY-BY-01','--run','rule01-old-snapshot','--count','4','--interval-ms','50','--seed','0','--scenario','mixed']);assert.equal(result.code,0,result.out);
  const evaluations=(await db.query('SELECT e.* FROM m04.measurement_evaluation e JOIN m04.measurement_record r ON r.id=e.record_id WHERE r.task_id=$1',[task.id])).rows;
  assert.equal(evaluations.length,4);assert.ok(evaluations.every((e:any)=>e.rule_snapshot.comparison.upper==='8'&&e.recipe_version_id===v1.id));
  ok(await command('/tasks/'+task.id+':end',{reason:'RULE01验证结束'},admin,{'If-Match':String(started.version)}));
 });
 await t.test('RULE01 automatic arrival refuses disabled pinned version and creates with explicitly selected new version',async()=>{
  const session=ok(await device('/device-sessions',{schema_version:'1.0',device_id:'HY-BY-01',data_environment:'SIMULATED',client_session_id:randomUUID(),producer_version:'RULE01'}));
  const event={schema_version:'1.0',device_id:'HY-BY-01',connection_id:session.connection_id,event_id:randomUUID(),encounter_id:randomUUID(),phase:'ENTER',occurred_at:new Date().toISOString(),meter:null,material_ref:'RULE01-AUTO-MATERIAL'};
  const failed=await device('/production-events',event);assert.equal(failed.status,422);assert.equal(failed.body.code,'RECIPE_DISABLED');
  const p=ok(await req('/discovery-profiles','GET',undefined,admin)).find((p:any)=>p.device_id==='HY-BY-01');
  ok(await command('/discovery-profiles/HY-BY-01',{enabled:true,specification_id:'SP035-300',recipe_version_id:v2.id},admin,{'If-Match':String(p.version)}));
  const created=ok(await device('/production-events',event));const auto=ok(await req('/tasks/'+created.task_id,'GET',undefined,admin));assert.equal(auto.recipe_version_id,v2.id);assert.equal(auto.rule_snapshot.comparison.upper,'7');assert.equal(auto.creation_source,'AUTO');
  ok(await device('/production-events',{...event,event_id:randomUUID(),phase:'EXIT',occurred_at:new Date().toISOString()}));
 });
 await t.test('RULE01 re-enable explicit historical version; audit and factory isolation',async()=>{
  const original=ok(await req('/recipes','GET',undefined,admin)).find((r:any)=>r.id===v1.id);
  assert.equal((await command(`/recipes/${v1.id}/status`,{enabled:true,reason:'恢复历史模拟版本'},viewer,{'If-Match':String(original.version)})).status,403);
  ok(await command(`/recipes/${v1.id}/status`,{enabled:true,reason:'恢复历史模拟版本'},admin,{'If-Match':String(original.version)}));
  assert.equal(ok(await command('/tasks',input,admin)).rule_snapshot.comparison.upper,'8');
  const history=ok(await req(`/recipes/${v1.id}/versions`,'GET',undefined,admin));assert.equal(history.versions.length,2);assert.ok(history.events.length>=4);
  const viewerId=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;
  await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[viewerId]);
  try{assert.equal((await req(`/recipes/${v1.id}/versions`,'GET',undefined,viewer)).status,404);assert.equal(ok(await req('/recipes','GET',undefined,viewer)).length,0);}finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[viewerId]);}
  assert.equal(Number((await db.query("SELECT count(*) FROM m00.audit_event WHERE action LIKE 'RECIPE_%'")).rows[0].count),5);
 });
}
