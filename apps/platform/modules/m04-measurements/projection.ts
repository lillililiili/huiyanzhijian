import type {PoolClient} from 'pg';
import Decimal from 'decimal.js';
import {verifySheath} from './sheath';

export const projectionVersion='PERF01.v1';
/** Called only after record/value/evaluation inserts, inside their transaction. */
export async function storeProjection(db:Pick<PoolClient,'query'>,recordId:string,metric:string,raw:any,value:unknown){
 const numeric=value===null||value===undefined?null:new Decimal(String(value)).toFixed(10);
 const sheath=metric==='OVALITY'?verifySheath(raw):null;
 await db.query(`INSERT INTO m04.measurement_projection(record_id,numeric_value,sheath_result,calculation_version)
 VALUES($1,$2,$3,$4) ON CONFLICT(record_id) DO NOTHING`,[recordId,numeric,JSON.stringify(sheath),projectionVersion]);
}
