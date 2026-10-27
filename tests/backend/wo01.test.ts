import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(resolve('package.json')), {Pool}=require('pg');
const root=resolve('../..'),local=Object.fromEntries(readFileSync(resolve(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const access=JSON.parse(readFileSync(resolve(root,'runtime/b1/access.json'),'utf8'));
const name='hy_wo01_test_'+Date.now(),env={...process.env,...local,DATABASE_URL:local.DATABASE_URL.replace('/huiyan_b1','/'+name),MIGRATION_DATABASE_URL:local.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+name),PORT:'4214'};
const evidence=resolve(root,'临时文件夹/WO01_工单删除',name);mkdirSync(evidence,{recursive:true});
let api:ChildProcess,logs='';const url='http://127.0.0.1:4214/api/v1';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function req(path:string,b?:any,h:any={},key=randomUUID()){
 const r=await fetch(url+path,{method:b===undefined?'GET':'POST',headers:{...h,'Content-Type':'application/json','Idempotency-Key':key},body:b===undefined?undefined:JSON.stringify(b)});
 return {status:r.status,body:await r.json(),cookies:r.headers.getSetCookie()};
}
async function login(user:string){const r=await req('/auth/login',{username:user,password:access.users[user]});assert.equal(r.status,200);return {Cookie:r.cookies.map(s=>s.split(';')[0]).join('; '),'X-CSRF-Token':r.body.data.csrf_token};}
const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
test('WO01 isolated PostgreSQL deletion, audit, permissions and concurrent references',{timeout:90000},async t=>{
 const bootstrap=new Pool({connectionString:local.MIGRATION_DATABASE_URL});await bootstrap.query('CREATE DATABASE '+name);await bootstrap.end();
 for(const script of ['migrate','migrate','bootstrap'])execFileSync(process.execPath,['--import','tsx','db/'+script+'.ts'],{env,stdio:'pipe'});
 const owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL}),runtime=new Pool({connectionString:env.DATABASE_URL});
 try{
  api=spawn(process.execPath,['dist/composition/main.js'],{env,stdio:['ignore','pipe','pipe']});api.stdout!.on('data',s=>logs+=s);api.stderr!.on('data',s=>logs+=s);
  let ready=false;for(let n=0;n<80;n++){try{if((await fetch(url+'/health/ready')).ok){ready=true;break;}}catch{}await pause(100);}assert.ok(ready);
  const admin=await login('admin'),viewer=await login('viewer');
  const create=async()=>ok(await req('/work-orders',{external_code:'WO01-'+randomUUID(),specification_id:'SP035-400'},admin));
  const remove=(id:string,h:any=admin,b:any={reason:'隔离验收：重复录入'},key?:string)=>req('/work-orders/'+id+':delete',b,h,key);
  const detail=async(id:string)=>ok(await req('/work-order-summaries/'+id,undefined,admin));
  await t.test('empty work order disappears from all read models, audit persists, retry is idempotent',async()=>{
   const w=await create();assert.equal((await detail(w.id)).can_delete,true);const key=randomUUID();
   const first=ok(await remove(w.id,admin,undefined,key));assert.equal(first.deleted,true);assert.deepEqual(ok(await remove(w.id,admin,undefined,key)),first);
   assert.equal((await remove(w.id,admin,{reason:'different'},key)).status,409);
   assert.equal((await req('/work-order-summaries/'+w.id,undefined,admin)).status,404);
   assert.equal(ok(await req('/production/work-orders?q='+w.external_code,undefined,admin)).total,0);
   assert.ok(!ok(await req('/work-orders',undefined,admin)).items.some((r:any)=>r.id===w.id));
   assert.equal((await owner.query('SELECT 1 FROM m02.work_order WHERE id=$1',[w.id])).rowCount,0);
   const audits=ok(await req('/admin/audits?resource_id='+w.id+'&action=WORK_ORDER_DELETED',undefined,admin));assert.equal(audits.total,1);
   const a=audits.items[0];assert.equal(a.details.before.external_code,w.external_code);assert.equal(a.details.reason,'隔离验收：重复录入');assert.equal(a.details.after,null);assert.ok(a.actor_id&&a.occurred_at&&a.request_id);
   await assert.rejects(runtime.query('DELETE FROM m00.audit_event WHERE id=$1',[a.id]));
  });
  await t.test('unauthenticated, viewer, CSRF, cross-factory, invalid reason and missing ID reject',async()=>{
   const w=await create();assert.equal((await remove(w.id,{})).status,401);assert.equal((await remove(w.id,viewer)).status,403);
   assert.equal((await remove(w.id,{Cookie:admin.Cookie})).status,403);
   assert.equal((await remove(w.id,admin,{reason:'  '})).status,400);assert.equal((await remove(w.id,admin,{reason:'x'.repeat(1001)})).status,400);
   assert.equal((await remove('missing')).status,404);
   await owner.query("INSERT INTO m02.work_order VALUES('wo01-other','other-factory','PLATFORM','OTHER','SP035-400',now())");assert.equal((await remove('wo01-other')).status,404);
   assert.equal((await owner.query('SELECT 1 FROM m02.work_order WHERE id=$1',[w.id])).rowCount,1);
   assert.ok(ok(await req('/admin/audits?action=WORK_ORDER_DELETE_REJECTED&resource_id='+w.id,undefined,admin)).total>=3);
  });
  await t.test('registered cable, external/auto source and all task lifecycle states protected',async()=>{
   for(const source of ['AUTO','MES']){const w=await create();await owner.query('UPDATE m02.work_order SET source_system=$2 WHERE id=$1',[w.id,source]);assert.equal((await detail(w.id)).can_delete,false);assert.equal((await remove(w.id)).status,409);}
   const w=await create(),spool=ok(await req('/spools',{work_order_id:w.id,spool_code:'CABLE'},admin));assert.equal((await detail(w.id)).delete_block_reason,'已登记线缆，不可删除');assert.equal((await remove(w.id)).status,409);
   const task=ok(await req('/tasks',{work_order_id:w.id,spool_id:spool.id,specification_id:'SP035-400',process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:'DG-V1.0',planned_length_m:'10'},admin));
   for(const state of ['CREATED','RUNNING','ENDED','CANCELLED']){await owner.query('UPDATE m02.inspection_task SET state=$2 WHERE id=$1',[task.id,state]);assert.equal((await detail(w.id)).can_delete,false);assert.equal((await remove(w.id)).status,409);}
   const original=await create();await owner.query('ALTER TABLE m02.inspection_task DISABLE TRIGGER USER');
   try{await owner.query('UPDATE m02.inspection_task SET original_work_order_id=$2 WHERE id=$1',[task.id,original.id]);}finally{await owner.query('ALTER TABLE m02.inspection_task ENABLE TRIGGER USER');}
   const d=await detail(original.id);assert.equal(d.task_count,0);assert.equal(d.registered_spools,0);assert.equal(d.can_delete,false);assert.equal((await remove(original.id)).status,409);
  });
  const planBody=(w:any)=>({name:'WO01 draft',items:[{work_order_id:w.id,spool_id:'pending-spool',specification_id:'SP035-400',process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:'DG-V1.0',planned_length_m:'10'}]});
  await t.test('draft and removed plan references block deletion; deleted order cannot enter a new plan',async()=>{
   const w=await create(),p=ok(await req('/plans',planBody(w),admin));assert.equal((await detail(w.id)).can_delete,false);assert.equal((await remove(w.id)).status,409);
   await owner.query('UPDATE m02.plan_item SET removed_at=now() WHERE plan_id=$1',[p.id]);assert.equal((await remove(w.id)).status,409);
   const empty=await create();ok(await remove(empty.id));assert.equal((await req('/plans',planBody(empty),admin)).status,404);
  });
  await t.test('concurrent duplicate deletion produces one audit',async()=>{
   const w=await create();const r=await Promise.all([remove(w.id),remove(w.id)]);assert.deepEqual(r.map(x=>x.status).sort(),[200,404]);
   assert.equal((await owner.query("SELECT count(*)::int n FROM m00.audit_event WHERE resource_id=$1 AND action='WORK_ORDER_DELETED'",[w.id])).rows[0].n,1);
  });
  await t.test('a committed cable arriving during row-lock wait prevents stale empty deletion',async()=>{
   const w=await create(),c=await owner.connect();await c.query('BEGIN');
   try{
    await c.query('INSERT INTO m02.cable_spool(id,factory_id,work_order_id,spool_code) VALUES($1,$2,$3,$4)',[randomUUID(),'factory-local',w.id,'RACE']);
    const pending=remove(w.id);await pause(100);await c.query('COMMIT');assert.equal((await pending).status,409);
   }finally{await c.query('ROLLBACK');c.release();}
   assert.equal((await detail(w.id)).registered_spools,1);
  });
  await t.test('plan creation vs deletion is serialized without dangling plan references',async()=>{
   for(let i=0;i<3;i++){
    const w=await create();const [d,p]=await Promise.all([remove(w.id),req('/plans',planBody(w),admin)]);
    assert.ok(d.status===200&&p.status===404||d.status===409&&p.status===200,JSON.stringify([d,p]));
    const refs=await owner.query("SELECT 1 FROM m02.plan_item i WHERE i.request->>'work_order_id'=$1 AND NOT EXISTS(SELECT 1 FROM m02.work_order w WHERE w.id=$1)",[w.id]);assert.equal(refs.rowCount,0);
   }
  });
  await t.test('concurrent cable registration either blocks deletion or gets a not-found response',async()=>{
   for(let i=0;i<3;i++){
    const w=await create();const [d,s]=await Promise.all([remove(w.id),req('/spools',{work_order_id:w.id,spool_code:'CONCURRENT'},admin)]);
    assert.ok(d.status===200&&s.status===404||d.status===409&&s.status===200,JSON.stringify([d,s]));
   }
  });
  await t.test('audit write failure rolls back deletion and command receipt',async()=>{
   const w=await create(),key=randomUUID();
   await owner.query(`CREATE FUNCTION m00.wo01_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='WORK_ORDER_DELETED' THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$; CREATE TRIGGER wo01_audit_failure BEFORE INSERT ON m00.audit_event FOR EACH ROW EXECUTE FUNCTION m00.wo01_audit_failure()`);
   try{assert.equal((await remove(w.id,admin,undefined,key)).status,503);assert.equal((await owner.query('SELECT 1 FROM m02.work_order WHERE id=$1',[w.id])).rowCount,1);assert.equal((await owner.query('SELECT 1 FROM m02.command_receipt WHERE command_key=$1',[key])).rowCount,0);}
   finally{await owner.query('DROP TRIGGER wo01_audit_failure ON m00.audit_event; DROP FUNCTION m00.wo01_audit_failure()');}
   ok(await remove(w.id,admin,undefined,key));
  });
  writeFileSync(resolve(evidence,'result.json'),JSON.stringify({database:name,status:'passed',shared_database_modified:false},null,2));console.log('WO01 evidence: '+evidence);
 }finally{if(api&&!api.killed){api.kill();await pause(500);}await owner.end();await runtime.end();writeFileSync(resolve(evidence,'api.log'),logs);}
});
