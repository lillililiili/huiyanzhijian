import type {IdentityApi,Context} from '../m00-identity/api';
import {ApiError,idField,object,textField,requireValue} from '../../infrastructure/errors';
import {lock} from '../../infrastructure/db';
import type {TaskApi} from './api';

// M02 owns both the list eligibility and the authoritative transactional check.
export const deletionFacts=`
 EXISTS(SELECT 1 FROM m02.cable_spool s WHERE s.work_order_id=w.id) AS has_spools,
 EXISTS(SELECT 1 FROM m02.inspection_task t WHERE t.work_order_id=w.id OR t.original_work_order_id=w.id) AS has_task_history,
 EXISTS(SELECT 1 FROM m02.plan_item i JOIN m02.batch_plan p ON p.id=i.plan_id
        WHERE p.factory_id=w.factory_id AND i.request->>'work_order_id'=w.id) AS has_plan_reference`;

export function deletionEligibility(w:any){
 const reason=w.source_system!=='PLATFORM'?'自动发现或外部来源工单不可删除':
  w.has_task_history?'已有当前或历史检测任务，不可删除':
  w.has_spools?'已登记线缆，不可删除':
  w.has_plan_reference?'已有批量计划引用，不可删除':null;
 return {can_delete:reason===null,delete_block_reason:reason};
}

export class WorkOrderApi {
 constructor(private tasks:TaskApi,private identity:IdentityApi){}
 async remove(ctx:Context,id:string,b:any,key:string){
  try{
   idField(id);object(b,['reason']);textField(b.reason,1000);const reason=b.reason.trim();
   return await this.tasks.command(ctx,key,{action:'work-order-delete',id,reason},async db=>{
    await lock(db,'production:'+ctx.actor.factory);
    // This row lock also serializes against FK inserts of cable spools.
    const found=await db.query('SELECT * FROM m02.work_order WHERE id=$1 AND factory_id=$2 FOR UPDATE',[id,ctx.actor.factory]);
    requireValue(found.rowCount,'RESOURCE_NOT_FOUND','工单不存在或无权访问',404);
    // Separate statement sees any reference that committed while waiting for the row lock.
    const facts=(await db.query(`SELECT w.*,${deletionFacts} FROM m02.work_order w WHERE w.id=$1`,[id])).rows[0];
    const eligibility=deletionEligibility(facts);
    requireValue(eligibility.can_delete,'WORK_ORDER_NOT_DELETABLE',eligibility.delete_block_reason||'当前工单不可删除',409);
    await db.query('DELETE FROM m02.work_order WHERE id=$1',[id]);
    await this.identity.audit(ctx,'WORK_ORDER_DELETED','WORK_ORDER',id,{before:found.rows[0],after:null,reason},db);
    return {id,external_code:found.rows[0].external_code,deleted:true};
   });
  }catch(error){
   await this.identity.audit(ctx,'WORK_ORDER_DELETE_REJECTED','WORK_ORDER',id,
    {code:error instanceof ApiError?error.code:'DEPENDENCY_UNAVAILABLE'},undefined,'FAILURE').catch(()=>{});
   throw error;
  }
 }
}
