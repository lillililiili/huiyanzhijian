import {Pool} from 'pg';
import {ovalityTimeseries,isSampleReference} from '../modules/m04-measurements/timeseries';
import {storeProjection} from '../modules/m04-measurements/projection';
/** Operator-only, resumable, no edits to raw data. Live ingestion may continue. */
export async function backfillProjections(owner:Pool){
 let count=0;
 for(;;){const db=await owner.connect();try{await db.query('BEGIN');
  const rows=(await db.query(`SELECT r.id,r.factory_id,r.raw_payload,v.metric_code,v.value
   FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
   WHERE NOT EXISTS(SELECT 1 FROM m04.measurement_projection p WHERE p.record_id=r.id)
   ORDER BY r.ingest_order LIMIT 100`)).rows;
  if(!rows.length){await db.query('COMMIT');break;}
  for(const factory of [...new Set(rows.map(r=>r.factory_id))]){
   const selected=rows.filter(r=>r.factory_id===factory&&isSampleReference(r.raw_payload));
   const source=await ovalityTimeseries.read(factory,selected.map(r=>r.raw_payload));
   for(const row of selected){const v=source.get(row.raw_payload.point_id)!;row.raw_payload=v.raw_payload;row.value=v.value;}
  }
  for(const row of rows)await storeProjection(db,row.id,row.metric_code,row.raw_payload,row.value);
  await db.query('COMMIT');count+=rows.length;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 return count;
}
if(require.main===module){
 if(process.env.PERF01_BACKUP_CONFIRMED!=='yes'||!process.env.MIGRATION_DATABASE_URL)throw Error('Verified backup required');
 const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 backfillProjections(db).then(count=>console.log(JSON.stringify({projected:count}))).catch(()=>{console.error('Projection backfill interrupted; committed batches retained.');process.exitCode=1;}).finally(()=>db.end());
}
