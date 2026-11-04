/** M04 public read capabilities. All access is scoped to the authenticated factory. */
import type {PoolClient} from 'pg';
import Decimal from 'decimal.js';
import {pool} from '../../infrastructure/db';
import {ApiError} from '../../infrastructure/errors';
import {isSampleReference,ovalityTimeseries} from './timeseries';

export async function hydrateCalculatedValues(factory:string,rows:any[],db:Pick<PoolClient,'query'>=pool){
 if(!rows.length)return rows;
 const result=await db.query(`SELECT p.* FROM m04.measurement_projection p
 JOIN m04.measurement_record r ON r.id=p.record_id WHERE r.factory_id=$1 AND r.id=ANY($2::text[])`,[factory,rows.map(r=>r.id||r.record_id)]);
 const byId=new Map(result.rows.map(p=>[p.record_id,p]));
 for(const row of rows){const p=byId.get(row.id||row.record_id);if(!p)throw new ApiError(503,'PROJECTION_NOT_READY','计算结果尚未准备完成，请联系管理员补齐历史投影');
  row.value=p.numeric_value===null?null:new Decimal(p.numeric_value).toFixed(10);
  if(p.sheath_result)row.sheath_result=p.sheath_result;
 }
 return rows;
}
export async function hydrateMeasurementRows(factory:string,rows:any[],db:Pick<PoolClient,'query'>=pool){
 const selected=rows.filter(r=>isSampleReference(r.raw_payload));
 const values=await ovalityTimeseries.read(factory,selected.map(r=>r.raw_payload));
 for(const row of selected){const value=values.get(row.raw_payload.point_id)!;row.raw_payload=value.raw_payload;row.sample_storage='INFLUXDB';}
 // Callers inside a snapshot must reuse its connection; borrowing from the
 // pool here can deadlock every request when all connections hold snapshots.
 await hydrateCalculatedValues(factory,rows,db);
 return rows;
}
export async function readTaskStatistics(factory:string,ids:string[],db:Pick<PoolClient,'query'>=pool,includeQuarantined=false){
 if(!ids.length)return [];
 const missing=await db.query(`SELECT 1 FROM m04.measurement_record r
 WHERE r.factory_id=$1 AND r.task_id=ANY($2::text[]) AND NOT EXISTS
 (SELECT 1 FROM m04.measurement_projection p WHERE p.record_id=r.id) LIMIT 1`,[factory,ids]);
 if(missing.rowCount)throw new ApiError(503,'PROJECTION_NOT_READY','计算结果尚未准备完成，请联系管理员补齐历史投影');
 const prefix=includeQuarantined?'all_':'';
 const result=await db.query(`SELECT task_id,total::int,valid::int,invalid::int,passed::int,failed::int,unevaluated::int,quarantined::int,
 to_char(first_sample_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_sample_at,
 to_char(latest_sample_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS latest_sample_at,
 metric_code,unit,${prefix}minimum::text AS minimum,${prefix}maximum::text AS maximum,
 ${prefix}value_count::int AS value_count,${prefix}value_sum::text AS value_sum,calculation_version,updated_at
 FROM m04.task_statistics WHERE factory_id=$1 AND task_id=ANY($2::text[])`,[factory,ids]);
 return result.rows.map(r=>({...r,minimum:r.minimum===null?null:new Decimal(r.minimum).toFixed(10),maximum:r.maximum===null?null:new Decimal(r.maximum).toFixed(10),mean:r.value_count?new Decimal(r.value_sum).div(r.value_count).toString():null}));
}
export async function ovalityTaskStats(factory:string,ids:string[],db:Pick<PoolClient,'query'>,includeQuarantined=false){
 const rows=await readTaskStatistics(factory,ids,db,includeQuarantined);
 return new Map(rows.filter(r=>r.metric_code==='OVALITY').map(r=>[r.task_id,{n:r.value_count,sum:new Decimal(r.value_sum),min:r.minimum===null?null:new Decimal(r.minimum),max:r.maximum===null?null:new Decimal(r.maximum)}]));
}
