import assert from 'node:assert/strict';
import {taskActivity} from '../../apps/platform/composition/activity';
export async function b3r4Cases(t:any,h:any){
 const {req,command,device,login,db,owner}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const read=async(p:string)=>ok(await req(p,'GET',undefined,admin));
 const original=(await db.query('SELECT count(*)::int n FROM m04.measurement_record')).rows[0].n;
 await t.test('B3R4 work orders have stable server paging and empty orders remain visible',async()=>{
  await owner.query("INSERT INTO m02.work_order(id,factory_id,external_code,specification_id,source_system,created_at) SELECT 'b3r4-order-'||lpad(n::text,3,'0'),'factory-local','B3R4-list-'||n,'SP035-400','PLATFORM','2026-10-26T00:00:00Z' FROM generate_series(1,23)n");
  const a=await read('/production/work-orders?q=B3R4-list&limit=20'),b=await read('/production/work-orders?q=B3R4-list&limit=20&page=2');
  assert.equal(a.total,23);assert.equal(a.items.length,20);assert.equal(b.items.length,3);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,23);
  assert.ok(a.items.every((x:any)=>x.state==='NO_TASK'&&x.task_count===0&&x.physical_spools===0));
  assert.equal((await read('/production/work-orders?q=B3R4-list&state=RUNNING')).total,0);
  for(const q of ['limit=101','page=0','state=BAD','q=a&q=b','unexpected=x','from=bad'])assert.equal((await req('/production/work-orders?'+q,'GET',undefined,admin)).status,400,q);
 });
 await t.test('B3R4 order summary and nested filters follow current task association and group spools once',async()=>{
  for(const code of ['B3R2-A','B3R2-B']){
   const order=(await db.query('SELECT * FROM m02.work_order WHERE external_code=$1',[code])).rows[0];
   const result=await read('/work-order-summaries/'+order.id);
   assert.equal(result.task_count,(await db.query('SELECT count(*)::int n FROM m02.inspection_task WHERE work_order_id=$1',[order.id])).rows[0].n);
   assert.equal((await read('/production/tasks?work_order_id='+order.id)).total,result.task_count);
   const spools=await read('/production/spools?work_order_id='+order.id);assert.equal(new Set(spools.items.map((s:any)=>s.id)).size,spools.items.length);
  }
  const created=ok(await command('/work-orders',{external_code:'B3R4-created',specification_id:'SP035-400'},admin));
  assert.equal((await read('/work-order-summaries/'+created.id)).external_code,'B3R4-created');
  assert.equal((await req('/work-order-summaries/absent','GET',undefined,admin)).status,404);
 });
 await t.test('B3R4 latest received sample is independent of lifecycle and source sampling time',async()=>{
  const active=await read('/operations/overview');assert.ok(active.tasks.every((x:any)=>x.state==='RUNNING'&&x.activity.task_state==='RUNNING'));
  const ended=(await db.query("SELECT t.* FROM m02.inspection_task t WHERE state='ENDED' AND EXISTS(SELECT 1 FROM m04.measurement_record r WHERE r.task_id=t.id) LIMIT 1")).rows[0];
  const status=await read('/task-activity/'+ended.id),latest=(await db.query('SELECT * FROM m04.measurement_record WHERE task_id=$1 ORDER BY ingest_order DESC LIMIT 1',[ended.id])).rows[0];
  assert.equal(status.task_state,'ENDED');assert.equal(status.latest.record_id,latest.id);assert.match(status.latest.sample_time,/\.\d{6}Z$/);
  assert.equal((await req('/task-activity/absent','GET',undefined,admin)).status,404);
  assert.equal((await db.query('SELECT count(*)::int n FROM m04.measurement_record')).rows[0].n,original);
 });
 await t.test('B3R4 read permissions and factory boundaries protect order and operational views',async()=>{
  const task=(await db.query('SELECT id FROM m02.inspection_task LIMIT 1')).rows[0].id;
  const uid=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;
  for(const p of ['/production/work-orders','/operations/overview','/task-activity/'+task])assert.equal((await device(p)).status,403);
  assert.equal((await req('/production/work-orders','GET',undefined,viewer)).status,200);
  await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[uid]);
  try {assert.equal(ok(await req('/production/work-orders','GET',undefined,viewer)).total,0);assert.deepEqual(ok(await req('/operations/overview','GET',undefined,viewer)).tasks,[]);assert.equal((await req('/task-activity/'+task,'GET',undefined,viewer)).status,404);assert.equal((await req('/work-order-summaries/b3r4-order-001','GET',undefined,viewer)).status,404);}
  finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[uid]);}
 });
 await t.test('B3R4 observation handles stale, delayed, invalid and future samples without changing task state',()=>{
  const at='2026-10-26T00:01:00Z',task={state:'RUNNING'},check=(received:string,sampled:string)=>taskActivity(task,{online:false},{received_at:received,sample_time:sampled,data_status:'INVALID'},at);
  assert.equal(taskActivity(task,null,null,at).sampling,'NO_DATA');
  assert.equal(check('2026-10-26T00:00:59Z','2026-10-26T00:00:59Z').sampling,'RECENT_DATA');
  assert.equal(check('2026-10-26T00:00:59Z','2026-10-26T00:00:00Z').sampling,'DELAYED_DATA');
  assert.equal(check('2026-10-26T00:00:00Z','2026-10-26T00:00:00Z').sampling,'NO_RECENT_DATA');
  assert.equal(check('2026-10-26T00:00:59Z','2026-10-26T00:02:00Z').sampling,'CLOCK_UNVERIFIED');
  assert.equal(check('invalid','invalid').sampling,'CLOCK_UNVERIFIED');assert.equal(task.state,'RUNNING');
 });
}
