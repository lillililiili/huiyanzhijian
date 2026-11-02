import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {storeProjection} from '../../apps/platform/modules/m04-measurements/projection';
import {readTaskStatistics,hydrateCalculatedValues,ovalityTaskStats} from '../../apps/platform/modules/m04-measurements/storage-api';
import {ovalityTimeseries} from '../../apps/platform/modules/m04-measurements/timeseries';
import {pool as runtimePool} from '../../apps/platform/infrastructure/db';
const {Pool}=createRequire(resolve('apps/platform/package.json'))('pg');

test('PERF01 PostgreSQL derived writes and cached reads (rollback-only fixtures)',{skip:process.env.PERF01_TEST!=='yes'},async t=>{
 const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL}),db=await owner.connect();
 const originalRead=ovalityTimeseries.read;ovalityTimeseries.read=async()=>{throw Error('Unexpected TS read');};
 const factory='PERF01-'+randomUUID(),task='PERF01-'+randomUUID();
 try{await db.query('BEGIN');
  async function add(value:string|null,state='VALID',receipt='STORED',quality='PASS',when='2026-11-02T03:00:00Z'){
   const id=randomUUID();await db.query(`INSERT INTO m04.measurement_record
   (id,factory_id,device_id,source_record_key,capture_session_id,capture_sequence,task_id,sample_kind,sample_time,time_source,position_quality,source_type,data_environment,data_status,receipt_status,raw_payload,payload_hash,schema_version)
   VALUES($1,$2,'PERF01-DEVICE',$1,$1,1,$3,'NEW_SAMPLE',$4,'SIMULATOR','UNKNOWN','SIMULATOR','SIMULATED',$5,$6,'{}',repeat('a',64),'1.0')`,[id,factory,task,when,state,receipt]);
   await db.query(`INSERT INTO m04.measurement_value(record_id,metric_code,value,unit,data_status,source_quality_result,method_id,window_definition,sample_storage)
   VALUES($1,'OVALITY',NULL,'%', $2,'NOT_EVALUATED','PERF01','{}','INFLUXDB')`,[id,state]);
   await db.query(`INSERT INTO m04.measurement_evaluation(record_id,version,quality_result,reason_code,rule_snapshot) VALUES($1,1,$2,'PERF01','{}')`,[id,quality]);
   await storeProjection(db,id,'OVALITY',{},value);return id;
  }
  const first=await add('0');
  await t.test('duplicate projection is idempotent',async()=>{await storeProjection(db,first,'OVALITY',{},'999');const [s]=await readTaskStatistics(factory,[task],db);assert.equal(s.total,1);assert.equal(s.minimum,'0.0000000000');});
  await t.test('late, negative, invalid and quarantined values retain distinct scopes',async()=>{
   await add('-2','VALID','STORED','FAIL','2026-11-01T03:00:00Z');await add('8');await add('100','VALID','QUARANTINED','NOT_EVALUATED');await add(null,'INVALID','STORED','NOT_EVALUATED');
   const [s]=await readTaskStatistics(factory,[task],db);assert.equal(s.total,5);assert.equal(s.valid,4);assert.equal(s.invalid,1);assert.equal(s.failed,1);assert.equal(s.quarantined,1);assert.equal(s.unevaluated,2);assert.equal(s.value_count,3);assert.equal(s.mean,'2');assert.equal(s.minimum,'-2.0000000000');assert.equal(s.maximum,'8.0000000000');assert.match(s.first_sample_at,/2026-11-01/);
   const [all]=await readTaskStatistics(factory,[task],db,true);assert.equal(all.maximum,'100.0000000000');assert.equal(all.value_count,4);
  });
  await t.test('factory isolation',async()=>{assert.deepEqual(await readTaskStatistics('OTHER',[task],db),[]);await assert.rejects(()=>hydrateCalculatedValues('OTHER',[{id:first}],db),/计算结果/);});
  await t.test('latest cached value and shared statistics never access TS',async()=>{
   const rows=await hydrateCalculatedValues(factory,[{record_id:first}],db);assert.equal(rows[0].value,'0.0000000000');assert.equal(rows[0].sheath_result.status,'NOT_PROVIDED');assert.equal((await ovalityTaskStats(factory,[task],db)).get(task)?.n,3);
  });
  await t.test('partial projection is a visible error, not a partial total',async()=>{
   await db.query('SAVEPOINT missing');await db.query('DELETE FROM m04.measurement_projection WHERE record_id=$1',[first]);await assert.rejects(()=>readTaskStatistics(factory,[task],db),/计算结果/);await db.query('ROLLBACK TO missing');
  });
  await t.test('rollback removes both new projection and accumulator contribution',async()=>{
   await db.query('SAVEPOINT addone');await add('123');assert.equal((await readTaskStatistics(factory,[task],db))[0].total,6);await db.query('ROLLBACK TO addone');assert.equal((await readTaskStatistics(factory,[task],db))[0].total,5);
  });
  await t.test('application role can persist calculations but cannot delete them',async()=>{
   await db.query('SET LOCAL ROLE hy_runtime');await add('4');assert.equal((await readTaskStatistics(factory,[task],db))[0].total,6);await db.query('SAVEPOINT denied');await assert.rejects(()=>db.query('DELETE FROM m04.measurement_projection WHERE record_id=$1',[first]));await db.query('ROLLBACK TO denied');await db.query('RESET ROLE');
  });
  await t.test('normal ingestion persists projections in its transaction; source retry does not increment',async()=>{
   process.env.CONTRACT_ROOT=resolve('contracts');const {MeasurementApi}=await import('../../apps/platform/modules/m04-measurements/api');
   const oldQuery=runtimePool.query,oldConnect=runtimePool.connect,oldWrite=ovalityTimeseries.write;
   (runtimePool as any).query=(...args:any[])=>db.query(...args);
   (runtimePool as any).connect=async()=>({query:(sql:string,args:any[])=>db.query(sql==='BEGIN'?'SAVEPOINT ingest_one':sql==='COMMIT'?'RELEASE SAVEPOINT ingest_one':sql==='ROLLBACK'?'ROLLBACK TO SAVEPOINT ingest_one':sql,args),release(){}});
   let tsWrites=0;ovalityTimeseries.write=async()=>{tsWrites++;return {storage:'INFLUXDB'} as any;};
   try{for(const metric of ['WIRE_GAP','OVALITY']){
    const body=JSON.parse(readFileSync('contracts/devices/v1/examples/01-measurements.json','utf8')),r=body.records[0];
    r.record_id=randomUUID();r.capture_session_id=randomUUID();r.task_id=task+'-'+metric;r.device_id='PERF01-'+metric;r.values[0].metric_code=metric;r.values[0].unit=metric==='OVALITY'?'%':'mm';
    const api=new MeasurementApi({} as any,{getDevice:async()=>({enabled:true,data_environment:'SIMULATED',metric_code:metric,raw_schema_versions:[r.raw.schema_version],source_identification:'SAMPLE_ID'})} as any,{verifyRecord:async()=>({rule_snapshot:{}})} as any,{evaluate:()=>({quality_result:'PASS',reason_code:'PERF01'})} as any);
    const ctx:any={actor:{kind:'DEVICE',id:'PERF01',factory,environment:'SIMULATED',devices:[r.device_id],permissions:['device:ingest']},requestId:randomUUID()};
    const first=await api.ingest(ctx,body);assert.equal(first.counts.stored,1,JSON.stringify(first));const retry=await api.ingest(ctx,body);assert.equal(retry.counts.duplicate,1);
    const [s]=await readTaskStatistics(factory,[r.task_id],db);assert.equal(s.total,1);assert.equal(s.mean,'1.25');
   }assert.equal(tsWrites,1);
   }finally{runtimePool.query=oldQuery;runtimePool.connect=oldConnect;ovalityTimeseries.write=oldWrite;}
  });
 }finally{ovalityTimeseries.read=originalRead;await db.query('ROLLBACK');db.release();await owner.end();await runtimePool.end();}
});
