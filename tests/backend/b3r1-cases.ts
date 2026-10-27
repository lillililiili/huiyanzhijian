import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function b3r1Cases(t:any,h:any){
 const {req,command,device,login,db,owner,sim}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const root=(await db.query("SELECT * FROM m02.cable_spool WHERE spool_code='B3-renamed'")).rows[0];
 const rootTask=(await db.query("SELECT * FROM m02.inspection_task WHERE spool_id=$1 AND metric_code='SHIELD_OVERLAP_RATE'",[root.id])).rows[0];
 const child=ok(await command('/spools',{work_order_id:root.work_order_id,spool_code:'B3R1-child'},admin));
 const empty=ok(await command('/spools',{work_order_id:root.work_order_id,spool_code:'B3R1-empty'},admin));
 const input={work_order_id:root.work_order_id,spool_id:child.id,specification_id:rootTask.specification_id,process_id:rootTask.process_id,device_id:rootTask.device_id,metric_code:rootTask.metric_code,recipe_version_id:rootTask.recipe_version_id,planned_length_m:'50'};
 const task=ok(await command('/tasks',input,admin));ok(await command('/tasks/'+task.id+':start',{},admin,{'If-Match':String(task.version)}));
 const run=await sim(['run','--device','HY-DG-01','--run','b3r1-child','--count','4','--interval-ms','50','--scenario','mixed']);assert.equal(run.code,0,run.out);
 const active=ok(await req('/tasks/'+task.id,'GET',undefined,admin));ok(await command('/tasks/'+task.id+':end',{reason:'B3R1 isolated test'},admin,{'If-Match':String(active.version)}));
 // Isolated load fixture: production traffic and existing user data are never altered.
 await owner.query(`INSERT INTO m02.inspection_task(id,factory_id,task_code,work_order_id,spool_id,device_id,process_id,specification_id,metric_code,recipe_version_id,planned_length_m,data_environment,state,rule_snapshot,context_snapshot)
 SELECT 'b3r1-load-'||n,t.factory_id,'B3R1-LOAD-'||n,t.work_order_id,t.spool_id,t.device_id,t.process_id,t.specification_id,t.metric_code,t.recipe_version_id,t.planned_length_m,t.data_environment,'CREATED',t.rule_snapshot,t.context_snapshot FROM m02.inspection_task t CROSS JOIN generate_series(1,200) n WHERE t.id=$1`,[task.id]);
 const edit=async(target:string|null,code='B3R1-child')=>{const current=(await db.query('SELECT * FROM m02.cable_spool WHERE id=$1',[child.id])).rows[0];return ok(await command('/spools/'+child.id+':edit',{spool_code:code,canonical_spool_id:target,reason:'B3R1 controlled trace test'},admin,{'If-Match':String(current.version)}));};
 await edit(root.id);
 await t.test('B3R1 same-spool summary covers all 203 tasks and keeps per-task facts and units',async()=>{
  const a=ok(await req('/spool-summaries/'+root.id,'GET',undefined,admin)),b=ok(await req('/spool-summaries/'+child.id,'GET',undefined,viewer));
  assert.equal(a.root_id,root.id);assert.equal(a.tasks.length,203);assert.equal(a.members.length,2);assert.equal(a.scope_hash,b.scope_hash);
  assert.equal(a.measurements.reduce((n:number,s:any)=>n+s.total,0),12);assert.equal(a.measurements.reduce((n:number,s:any)=>n+s.valid,0),9);assert.equal(a.measurements.reduce((n:number,s:any)=>n+s.invalid,0),3);
  assert.equal(a.tasks.find((x:any)=>x.id===task.id).spool_id,child.id);assert.equal(a.tasks.find((x:any)=>x.id===task.id).context_snapshot.spool_code,'B3R1-child');
  const m=a.measurements.find((x:any)=>x.task_id===rootTask.id);assert.equal(m.minimum,'9.9999999999');assert.equal(m.maximum,'12.5000000001');assert.ok(typeof m.mean==='string');assert.equal(m.unit,'%');
  assert.equal(ok(await req('/spool-summaries/'+empty.id,'GET',undefined,admin)).tasks.length,0);
 });
 await t.test('B3R1 spool history beyond 200 tasks intersects filters and never widens unknown scope',async()=>{
  const a=ok(await req('/measurements?spool_id='+root.id+'&limit=100','GET',undefined,admin));assert.equal(a.items.length,12);assert.equal(a.scope.task_count,203);
  assert.equal(ok(await req('/measurements?spool_id='+child.id+'&limit=100','GET',undefined,admin)).items.length,12);
  assert.equal(ok(await req('/measurements?spool_id='+empty.id,'GET',undefined,admin)).items.length,0);
  assert.equal((await req('/measurements?spool_id=missing-spool','GET',undefined,admin)).status,404);
  assert.equal(ok(await req('/measurements?spool_id='+root.id+'&task_id=unrelated','GET',undefined,admin)).items.length,0);
  assert.equal(ok(await req('/measurements?spool_id='+root.id+'&data_status=INVALID','GET',undefined,admin)).items.length,3);
  assert.equal(ok(await req('/measurements?spool_id='+root.id+'&receipt_status=QUARANTINED','GET',undefined,admin)).items.length,0);
  assert.equal(ok(await req('/measurements?spool_id='+root.id+'&process_id=process-by','GET',undefined,admin)).items.length,0);
  assert.equal((await req('/measurements?data_status=BAD','GET',undefined,admin)).status,400);
  assert.equal((await req('/measurements?receipt_status=BAD','GET',undefined,admin)).status,400);
 });
 await t.test('B3R1 frozen history excludes late records, exports all pages, rejects changed membership or name',async()=>{
  const path='/measurements?spool_id='+root.id+'&limit=3&order=desc',first=ok(await req(path,'GET',undefined,admin));
  const raw=(await db.query('SELECT raw_payload FROM m04.measurement_record WHERE task_id=$1 ORDER BY ingest_order LIMIT 1',[task.id])).rows[0].raw_payload;
  const inserted=ok(await device('/measurements:ingest',{schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records:[{...raw,record_id:randomUUID(),capture_sequence:'999999'}]}));assert.equal(inserted.items[0].receipt_status,'STORED');
  let p=first;const rows=[...first.items];while(p.has_more){p=ok(await req(path+'&cursor='+encodeURIComponent(p.next_cursor),'GET',undefined,admin));rows.push(...p.items);}assert.equal(rows.length,12);assert.equal(new Set(rows.map(x=>x.id)).size,12);assert.ok(!rows.some(x=>x.id===inserted.items[0].stored_id));
  await edit(root.id,'B3R1-renamed');const stale=await req(path+'&cursor='+encodeURIComponent(first.next_cursor),'GET',undefined,admin);assert.equal(stale.status,400);assert.match(stale.body.message,/范围已变化/);
  const fresh=ok(await req(path,'GET',undefined,admin));assert.equal(fresh.scope.members.find((s:any)=>s.id===child.id).spool_code,'B3R1-renamed');
  await edit(null,'B3R1-renamed');assert.equal((await req(path+'&cursor='+encodeURIComponent(fresh.next_cursor),'GET',undefined,admin)).status,400);
  assert.equal(ok(await req('/measurements?spool_id='+root.id+'&limit=100','GET',undefined,admin)).items.length,8);
  assert.equal(ok(await req('/measurements?spool_id='+child.id+'&limit=100','GET',undefined,admin)).items.length,5);
  assert.equal(ok(await req('/tasks/'+task.id,'GET',undefined,admin)).context_snapshot.spool_code,'B3R1-child');
 });
 await t.test('B3R1 new task invalidates scope cursor; factory and device access remain isolated',async()=>{
  const path='/measurements?spool_id='+child.id+'&limit=1',first=ok(await req(path,'GET',undefined,admin));ok(await command('/tasks',input,admin));
  assert.equal((await req(path+'&cursor='+encodeURIComponent(first.next_cursor),'GET',undefined,admin)).status,400);
  assert.equal((await device('/spool-summaries/'+root.id)).status,403);
  const user=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[user]);
  try{assert.equal((await req('/spool-summaries/'+root.id,'GET',undefined,viewer)).status,404);assert.equal((await req('/measurements?spool_id='+root.id,'GET',undefined,viewer)).status,404);}finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[user]);}
 });
}
