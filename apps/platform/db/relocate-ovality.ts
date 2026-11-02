// Operator-only, resumable relocation. Never run with the application role.
import {Pool} from 'pg';
import {isSampleReference,ovalityTimeseries} from '../modules/m04-measurements/timeseries';
export async function relocateOvality(owner:Pool){
 let count=0;
 for(;;){const db=await owner.connect();try{await db.query('BEGIN');
 const rows=(await db.query(`SELECT r.id,r.factory_id,r.device_id,r.source_record_key,r.payload_hash,r.raw_payload,v.value
 FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
 WHERE v.metric_code='OVALITY' AND v.sample_storage='POSTGRESQL'
 ORDER BY r.ingest_order LIMIT 50 FOR UPDATE OF r,v SKIP LOCKED`)).rows;
 if(!rows.length){await db.query('COMMIT');break;}
 for(const row of rows){if(isSampleReference(row.raw_payload))throw Error('Inconsistent storage marker');
  const ref=await ovalityTimeseries.write(row.factory_id,row.device_id,row.source_record_key,row.payload_hash.trim(),row.raw_payload,row.value);
  const confirmed=(await ovalityTimeseries.read(row.factory_id,[ref])).get(ref.point_id)!;
  if(JSON.stringify(confirmed.raw_payload)!==JSON.stringify(row.raw_payload)||confirmed.value!==row.value)throw Error('Relocation verification failed');
  await db.query('UPDATE m04.measurement_record SET raw_payload=$2 WHERE id=$1',[row.id,JSON.stringify(ref)]);
  await db.query("UPDATE m04.measurement_value SET value=NULL,sample_storage='INFLUXDB' WHERE record_id=$1",[row.id]);
 }await db.query('COMMIT');count+=rows.length;console.log(JSON.stringify({event:'OVALITY_RELOCATED',count}));
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 return count;
}
export async function restoreOvality(owner:Pool){
 let count=0;
 for(;;){const db=await owner.connect();try{await db.query('BEGIN');
 const rows=(await db.query(`SELECT r.id,r.factory_id,r.raw_payload FROM m04.measurement_record r
 JOIN m04.measurement_value v ON v.record_id=r.id WHERE v.metric_code='OVALITY' AND v.sample_storage='INFLUXDB'
 ORDER BY r.ingest_order LIMIT 50 FOR UPDATE OF r,v SKIP LOCKED`)).rows;
 if(!rows.length){await db.query('COMMIT');break;}
 for(const row of rows){if(!isSampleReference(row.raw_payload))throw Error('Inconsistent storage marker');
  const data=(await ovalityTimeseries.read(row.factory_id,[row.raw_payload])).get(row.raw_payload.point_id)!;
  await db.query('UPDATE m04.measurement_record SET raw_payload=$2 WHERE id=$1',[row.id,JSON.stringify(data.raw_payload)]);
  await db.query("UPDATE m04.measurement_value SET value=$2,sample_storage='POSTGRESQL' WHERE record_id=$1",[row.id,data.value]);
 }await db.query('COMMIT');count+=rows.length;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 return count;
}
if(require.main===module){
 if(process.env.TS01_BACKUP_CONFIRMED!=='yes'||!process.env.MIGRATION_DATABASE_URL)throw Error('Verified backup and migration credentials required');
 const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});(process.argv.includes('--restore')?restoreOvality(db):relocateOvality(db)).catch(()=>{console.error('OVALITY relocation interrupted; committed batches preserved, rerun safely after resolving the dependency.');process.exitCode=1;}).finally(()=>db.end());
}
