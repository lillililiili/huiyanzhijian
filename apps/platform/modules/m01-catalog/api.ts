import type {PoolClient} from 'pg';
import {pool} from '../../infrastructure/db';
import {ApiError} from '../../infrastructure/errors';
export class CatalogApi{
 async factories(ids:string[]){return (await pool.query("SELECT id,name FROM m01.factory WHERE id=ANY($1::text[]) AND status='ACTIVE' ORDER BY id",[ids])).rows;}
 async timezone(factory:string,db:PoolClient|typeof pool=pool){const r=await db.query('SELECT timezone FROM m01.factory WHERE id=$1',[factory]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','工厂不存在');return r.rows[0].timezone as string;}
 async getDevice(factory:string,id:string,db:PoolClient|typeof pool=pool){const r=await db.query('SELECT * FROM m01.device WHERE factory_id=$1 AND id=$2',[factory,id]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','设备不存在');return r.rows[0];}
 async getSpecification(factory:string,id:string,db:PoolClient|typeof pool=pool){const r=await db.query('SELECT * FROM m01.product_specification WHERE factory_id=$1 AND id=$2',[factory,id]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','规格不存在');return r.rows[0];}
 async applicable(spec:string,process:string,metric:string,db:PoolClient|typeof pool=pool){return !!(await db.query('SELECT 1 FROM m01.specification_applicability WHERE specification_id=$1 AND process_id=$2 AND metric_code=$3',[spec,process,metric])).rowCount;}
 async metricApplicable(spec:string,metric:string,db:PoolClient|typeof pool=pool){return !!(await db.query('SELECT 1 FROM m01.specification_applicability WHERE specification_id=$1 AND metric_code=$2',[spec,metric])).rowCount;}
 async list(factory:string){const result:Record<string,unknown>={};for(const table of ['production_line','inspection_process','device','product_specification'])result[table]=(await pool.query(`SELECT * FROM m01.${table} WHERE factory_id=$1 ORDER BY id`,[factory])).rows;result.specification_applicability=(await pool.query('SELECT a.* FROM m01.specification_applicability a JOIN m01.product_specification s ON s.id=a.specification_id WHERE s.factory_id=$1 ORDER BY a.specification_id,a.process_id,a.metric_code',[factory])).rows;return result;}
}
