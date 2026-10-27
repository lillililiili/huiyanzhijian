import assert from 'node:assert/strict';

export async function b3r3Cases(t:any,h:any){
 const {req,command,login,db,owner,device}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const read=async(path:string)=>ok(await req(path,'GET',undefined,admin));
 const original=(await db.query("SELECT count(*)::int n FROM m04.measurement_record")).rows[0].n;
 const a=(await db.query("SELECT * FROM m02.cable_spool WHERE spool_code='B3R2-A'")).rows[0];
 const tasks=(await db.query('SELECT * FROM m02.inspection_task WHERE spool_id=$1 ORDER BY state',[a.id])).rows;
 await owner.query("INSERT INTO m02.batch_plan(id,factory_id,name,created_by,created_at) SELECT 'b3r3-plan-'||lpad(n::text,4,'0'),'factory-local','B3R3-load-'||n,'fixture','2026-10-26T00:00:00Z' FROM generate_series(1,502)n");
 await owner.query("INSERT INTO m02.cable_spool(id,factory_id,work_order_id,spool_code,created_at) SELECT 'b3r3-spool-'||lpad(n::text,4,'0'),'factory-local',$1,'B3R3-load-'||n,'2026-10-26T00:00:00Z' FROM generate_series(1,502)n",[a.work_order_id]);
 await t.test('B3R3 plan and cable lists paginate beyond 500 with deterministic ties and whole-result totals',async()=>{
  for(const type of ['plans','spools']){
   const seen:string[]=[];
   for(let page=1;page<=6;page++){const r=await read(`/production/${type}?q=B3R3-load&limit=100&page=${page}`);assert.equal(r.total,502);assert.equal(r.items.length,page===6?2:100);seen.push(...r.items.map((x:any)=>x.id));}
   assert.equal(new Set(seen).size,502);assert.deepEqual(seen,[...seen].sort().reverse());
   const empty=await read(`/production/${type}?q=B3R3-load&limit=100&page=7`);assert.equal(empty.total,502);assert.equal(empty.items.length,0);
   assert.equal((await read(`/production/${type}?q=%25`)).total,0);
  }
 });
 const p='b3r3-mixed';await owner.query("INSERT INTO m02.batch_plan(id,factory_id,name,created_by) VALUES($1,'factory-local','B3R3-mixed','fixture')",[p]);
 for(let n=0;n<tasks.length;n++){const task=tasks[n],request=Object.fromEntries(['work_order_id','spool_id','specification_id','device_id','metric_code','process_id','recipe_version_id','planned_length_m'].map(k=>[k,task[k]]));await owner.query('INSERT INTO m02.plan_item(id,plan_id,ordinal,request,task_id) VALUES($1,$2,$3,$4,$5)',['b3r3-item-'+n,p,n+1,JSON.stringify(request),task.id]);}
 await t.test('B3R3 plan state, active-item filters and partial failure counts have explicit semantics',async()=>{
  const r=await read('/production/plans?q=B3R3-mixed&state=PARTIAL&device_id=HY-DG-01&specification_id=SP035-400&environment=SIMULATED');assert.equal(r.total,1);assert.equal(r.items[0].active_count,2);assert.equal(r.items[0].waiting_count,1);assert.equal(r.items[0].ended_count,1);
  assert.equal((await read('/production/plans?q=B3R3-mixed&device_id=HY-BY-01')).total,0);
  await owner.query(`UPDATE m02.plan_item SET last_error='{"message":"fixture failure"}' WHERE id='b3r3-item-0'`);
  assert.equal((await read('/production/plans?q=B3R3-mixed&state=FAILED&has_errors=true')).items[0].failed_count,1);
  assert.equal((await read('/production/plans?q=B3R3-mixed&has_errors=false')).total,0);
  assert.equal((await read('/production/plans?q=B3R3-load&state=EMPTY')).total,502);
 });
 await t.test('B3R3 task page and plan detail receive batch sample summaries with exact decimals and empty values',async()=>{
  const r=await read('/production/tasks?plan_id='+p);assert.equal(r.items.length,2);
  const withData=r.items.find((x:any)=>x.state==='ENDED'),empty=r.items.find((x:any)=>x.state==='CREATED');assert.equal(withData.measurements.total,9);assert.equal(withData.measurements.minimum,'9.9999999999');assert.equal(withData.measurements.maximum,'12.5000000001');const invalidFacts=(await db.query("SELECT count(*)::int n FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id WHERE r.task_id=$1 AND v.data_status<>'VALID'",[withData.id])).rows[0].n;assert.equal(withData.measurements.invalid,invalidFacts);assert.match(withData.measurements.latest_sample_at,/\.\d{6}Z$/);
  assert.equal(empty.measurements.total,0);assert.equal(empty.measurements.minimum,null);assert.equal(empty.measurements.latest_sample_at,null);
  const detail=await read('/plans/'+p);assert.deepEqual(detail.items.find((i:any)=>i.task.id===withData.id).task.measurements,withData.measurements);
  const existing=(await read('/production/tasks?q=B3R2-plan')).items[0];assert.equal(existing.current_order_code,'B3R2-B');assert.equal(existing.original_spool_id,a.id);
 });
 await t.test('B3R3 physical cable groups include empty spools and search members without duplicating root rows',async()=>{
  const member=ok(await command('/spools',{work_order_id:a.work_order_id,spool_code:'B3R3-member'},admin));
  ok(await command('/spools/'+member.id+':edit',{spool_code:member.spool_code,canonical_spool_id:a.id,reason:'B3R3 grouping fixture'},admin,{'If-Match':String(member.version)}));
  const r=await read('/production/spools?q=B3R3-member&state=PARTIAL&device_id=HY-DG-01&metric_code=SHIELD_OVERLAP_RATE&environment=SIMULATED');assert.equal(r.total,1);assert.equal(r.items[0].id,a.id);assert.equal(r.items[0].task_count,2);assert.equal(r.items[0].identity_count,2);
  assert.equal((await read('/production/spools?q=B3R3-member&device_id=HY-DG-01&metric_code=OVALITY')).total,0);
  assert.equal((await read('/production/spools?q=B3R3-load&state=NO_TASK')).total,502);
  assert.equal((await read('/production/spools?q=B3R3-load&environment=SIMULATED')).total,0);
  assert.equal((await read('/production/spools?q=B3R3-load&from=2026-10-26T00:00:00Z&to=2026-10-26T00:00:01Z')).total,502);
  assert.equal((await read('/production/spools?q=B3R3-load&to=2026-10-26T00:00:00Z')).total,0);
 });
 await t.test('B3R3 malformed filters, repeated params and wrong factory/device identities are rejected or hidden',async()=>{
  for(const type of ['plans','spools']){
   for(const query of ['page=0','limit=101','state=BAD','from=bad','from=2026-10-27T00:00:00Z&to=2026-10-26T00:00:00Z','environment=BAD','q=a&q=b','unexpected=x'])assert.equal((await req(`/production/${type}?${query}`,'GET',undefined,admin)).status,400,query);
   assert.equal((await device('/production/'+type)).status,403);
  }
  const uid=(await owner.query("SELECT id FROM m00.app_user WHERE login_name='viewer'")).rows[0].id;await owner.query("UPDATE m00.user_role SET factory_id='other-factory' WHERE user_id=$1",[uid]);
  try{for(const type of ['plans','spools'])assert.equal(ok(await req('/production/'+type,'GET',undefined,viewer)).total,0);}finally{await owner.query("UPDATE m00.user_role SET factory_id='factory-local' WHERE user_id=$1",[uid]);}
  assert.equal((await db.query('SELECT count(*)::int n FROM m04.measurement_record')).rows[0].n,original);
 });
}

