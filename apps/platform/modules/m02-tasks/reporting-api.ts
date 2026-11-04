import type {PoolClient} from 'pg';
import {requireValue} from '../../infrastructure/errors';
/** Public, read-only report context; caller owns the consistent snapshot transaction. */
export async function reportContext(db:PoolClient,factory:string,orderId:string,environment:string){
 const orders=(await db.query('SELECT id,external_code,specification_ids FROM m02.work_order WHERE factory_id=$1 AND ($2=\'\' OR id=$2) ORDER BY external_code',[factory,orderId])).rows;
 if(orderId)requireValue(orders.length,'NOT_FOUND','工单不存在或不可访问',404);
 const spools=(await db.query('SELECT id,work_order_id,spool_code,specification_id FROM m02.cable_spool WHERE factory_id=$1 AND ($2=\'\' OR work_order_id=$2) ORDER BY spool_code LIMIT 5001',[factory,orderId])).rows;
 const tasks=(await db.query(`SELECT id,task_code,work_order_id,spool_id,device_id,metric_code,data_environment,state,rule_snapshot,context_snapshot,started_at,ended_at FROM m02.inspection_task WHERE factory_id=$1 AND ($2='' OR work_order_id=$2) AND ($3='' OR data_environment=$3) ORDER BY task_code LIMIT 5001`,[factory,orderId,environment])).rows;
 requireValue(tasks.length<=5000&&spools.length<=5000,'REPORT_SCOPE_TOO_LARGE','范围超过5000项，请按工单缩小范围',422);
 return {orders,spools,tasks};
}
