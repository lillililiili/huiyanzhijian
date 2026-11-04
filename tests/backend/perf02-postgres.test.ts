import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../../apps/platform/infrastructure/db';
import {MeasurementApi} from '../../apps/platform/modules/m04-measurements/api';
import {storeProjection} from '../../apps/platform/modules/m04-measurements/projection';
import {hydrateMeasurementRows} from '../../apps/platform/modules/m04-measurements/storage-api';

test('PERF02 actual PostgreSQL snapshot and task activity (all fixtures rolled back)',{skip:process.env.PERF02_TEST!=='yes'},async t=>{
 const api=new MeasurementApi({} as any,{} as any,{} as any,{} as any);
 const db=await pool.connect(),factory='PERF02-'+randomUUID(),task='PERF02-'+randomUUID(),actor:any={factory};
 try{await db.query('BEGIN');
  async function add(f:string,tid:string,value:string,when:string,quality='PASS'){
   const id=randomUUID();await db.query(`INSERT INTO m04.measurement_record
   (id,factory_id,device_id,source_record_key,capture_session_id,capture_sequence,task_id,sample_kind,sample_time,time_source,position_quality,source_type,data_environment,data_status,receipt_status,raw_payload,payload_hash,schema_version)
   VALUES($1,$2,'PERF02-DEVICE',$1,$1,1,$3,'NEW_SAMPLE',$4,'SIMULATOR','UNKNOWN','SIMULATOR','SIMULATED','VALID','STORED','{}',repeat('a',64),'1.0')`,[id,f,tid,when]);
   await db.query(`INSERT INTO m04.measurement_value(record_id,metric_code,value,unit,data_status,source_quality_result,method_id,window_definition)
   VALUES($1,'WIRE_GAP',$2,'mm','VALID','NOT_EVALUATED','PERF02','{}')`,[id,value]);
   await db.query(`INSERT INTO m04.measurement_evaluation(record_id,version,quality_result,reason_code,rule_snapshot) VALUES($1,1,$2,'PERF02','{}')`,[id,quality]);
   await storeProjection(db,id,'WIRE_GAP',{},value);return id;
  }
  const first=await add(factory,task,'1.25','2026-11-02T00:00:02Z');
  const late=await add(factory,task,'4.1234567890','2026-11-02T00:00:01Z','FAIL');
  const other=await add(factory,task+'-2','-2','2026-11-02T00:00:03Z');
  await add(factory+'-other',task,'999','2026-11-02T00:00:04Z');
  await t.test('latest means received order, including late sample; projection and judgement preserved',async()=>{
   const rows=await api.taskActivity(actor,[task,task+'-2',task],db);assert.equal(rows.length,2);
   const row=rows.find(r=>r.task_id===task)!;assert.equal(row.record_id,late);assert.notEqual(row.record_id,first);assert.equal(row.value,'4.1234567890');assert.equal(row.quality_result,'FAIL');assert.match(row.sample_time,/00:00:01/);assert.equal('raw_payload' in row,false);
   assert.equal(rows.find(r=>r.record_id===other)?.value,'-2.0000000000');
  });
  await t.test('unknown and cross-factory task IDs cannot expose records',async()=>{
   assert.deepEqual(await api.taskActivity({factory:'missing'} as any,[task],db),[]);
   assert.deepEqual(await api.taskActivity(actor,['missing'],db),[]);
  });
  await t.test('empty task set does not issue SQL',async()=>{
   assert.deepEqual(await api.taskActivity(actor,[],{query:async()=>{throw Error('Unexpected SQL');}} as any),[]);
  });
  await t.test('new activity query agrees with old DISTINCT ON identity and exact value',async()=>{
   const old=(await db.query(`SELECT DISTINCT ON (r.task_id) r.task_id,r.id AS record_id,v.value::text,e.quality_result
   FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
   JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1
   WHERE r.factory_id=$1 AND r.task_id=ANY($2::text[]) ORDER BY r.task_id,r.ingest_order DESC`,[factory,[task,task+'-2']])).rows;
   const current=await api.taskActivity(actor,[task,task+'-2'],db);
   assert.deepEqual(current.map(({task_id,record_id,value,quality_result})=>({task_id,record_id,value,quality_result})),old);
  });
  await t.test('uncommitted projection is read on its owner connection',async()=>{
   const result=await hydrateMeasurementRows(factory,[{id:late,raw_payload:{}}],db);assert.equal(result[0].value,'4.1234567890');
  });
  await t.test('missing projection returns visible dependency failure',async()=>{
   await db.query('SAVEPOINT missing_projection');await db.query('DELETE FROM m04.measurement_projection WHERE record_id=$1',[late]);
   await assert.rejects(()=>api.taskActivity(actor,[task],db),/计算结果/);await db.query('ROLLBACK TO missing_projection');
  });
 }finally{await db.query('ROLLBACK');db.release();}
 await t.test('all ten connections can hydrate simultaneously without nested pool borrowing',async()=>{
  // A barrier forces every transaction to own a pool slot before hydration.
  // Rollback-only cases above prove this reads each transaction's own projection.
  let arrivals=0,open!:()=>void;const gate=new Promise<void>(r=>open=r);
  await Promise.all(Array.from({length:10},()=>transaction(async client=>{
   if(++arrivals===10)open();await gate;
   await assert.rejects(()=>hydrateMeasurementRows(factory,[{id:'absent',raw_payload:{}}],client),/计算结果/);
  })));
  assert.equal(pool.waitingCount,0);
 });
 await pool.end();
});
