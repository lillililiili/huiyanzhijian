import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {lock} from '../infrastructure/db';
import {IdentityApi,type Context} from '../modules/m00-identity/api';
import {CatalogApi} from '../modules/m01-catalog/api';
import {TaskApi} from '../modules/m02-tasks/api';
import {RuleApi} from '../modules/m03-rules/api';
import {storeSheathResult} from '../modules/m04-measurements/paired';

/** Append-only, restartable. Existing measurement facts/rules are never rewritten. */
export async function backfillSheathTasks(owner:Pool){
 const identity=new IdentityApi(),tasks=new TaskApi(identity,new CatalogApi(),new RuleApi());
 let created=0,derived=0;
 const sources=(await owner.query("SELECT id,factory_id FROM m02.inspection_task WHERE metric_code='OVALITY' ORDER BY created_at,id")).rows;
 for(const source of sources){const db=await owner.connect();try{
  await db.query('BEGIN');await lock(db,'production:'+source.factory_id);
  const current=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 FOR UPDATE',[source.id])).rows[0];
  const ctx:Context={actor:{id:'SYSTEM_HT03_BACKFILL',kind:'USER',factory:source.factory_id,permissions:[],devices:[],environment:null},requestId:randomUUID()};
  const existing=await tasks.sheathCompanion(source.factory_id,source.id,db);
  const child=await tasks.ensureCompanion(ctx,current,db);
  if(!existing){created++;await identity.audit(ctx,'SHEATH_HISTORY_LINKED','TASK',child.id,{source_task_id:source.id,reason:'历史护套结果拆分为独立任务，原采样及判定保留'},db);}
  await db.query('COMMIT');
  for(;;){await db.query('BEGIN');
   const rows=(await db.query(`SELECT r.id FROM m04.measurement_record r JOIN m04.measurement_projection p ON p.record_id=r.id
    WHERE r.task_id=$1 AND NOT EXISTS(SELECT 1 FROM m04.measurement_record d WHERE d.derived_from_record_id=r.id)
    ORDER BY r.ingest_order LIMIT 100`,[source.id])).rows;
   if(!rows.length){await db.query('COMMIT');break;}
   for(const row of rows)await storeSheathResult(db,row.id,child);
   await db.query('COMMIT');derived+=rows.length;
  }
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 return {created,derived};
}
if(require.main===module){
 if(process.env.HT03_BACKUP_CONFIRMED!=='yes'||!process.env.MIGRATION_DATABASE_URL)throw Error('Verified backup and migration connection required');
 const owner=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});
 backfillSheathTasks(owner).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error('HT03 backfill interrupted; committed batches retained.',e.code||e.message);process.exitCode=1;}).finally(()=>owner.end());
}
