import type {PoolClient} from 'pg';
const viewQueries={
 'm04.measurement_raw':'SELECT id,task_id,raw_payload FROM m04.measurement_raw LIMIT 0',
 'm07.measurement_outbox':'SELECT id,state,payload FROM m07.measurement_outbox LIMIT 0',
 'm06.quality_report_snapshot':'SELECT id,snapshot_hash FROM m06.quality_report_snapshot LIMIT 0',
 'm06.report_approval':'SELECT id,report_id,approval_state FROM m06.report_approval LIMIT 0',
} as const;
export class DatabaseReadinessError extends Error{
 readonly code='DATABASE_SCHEMA_NOT_READY';
 constructor(readonly object:string,readonly sqlstate?:string){super('Database object unavailable: '+object+'; run approved migrations with the migration role');}
}
/** Startup is read-only. Missing schema/privileges are deployment errors, never auto-DDL. */
export async function assertDatabaseViews(db:Pick<PoolClient,'query'>,names:readonly (keyof typeof viewQueries)[]=Object.keys(viewQueries) as (keyof typeof viewQueries)[]){
 for(const name of names){
  try{await db.query(viewQueries[name]);}
  catch(e:any){throw new DatabaseReadinessError(name,/^[0-9A-Z]{5}$/.test(e?.code)?e.code:undefined);}
 }
}
