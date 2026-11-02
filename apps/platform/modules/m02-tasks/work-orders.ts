import type {CatalogApi} from '../m01-catalog/api';
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
 constructor(private tasks:TaskApi,private identity:IdentityApi,private catalog:CatalogApi){}
 async specifications(ctx:Context,id:string,b:any,key:string){
  idField(id);object(b,['specification_ids']);requireValue(Array.isArray(b.specification_ids)&&b.specification_ids.length>0&&b.specification_ids.length<=100,'INVALID_INPUT','请选择1～100个规格');b.specification_ids.forEach(idField);
  const ids=[...new Set<string>(b.specification_ids)];
  return this.tasks.command(ctx,key,{action:'order-specifications',id,ids},async db=>{
   await lock(db,'production:'+ctx.actor.factory);
   const before=(await db.query('SELECT * FROM m02.work_order WHERE id=$1 AND factory_id=$2 FOR UPDATE',[id,ctx.actor.factory])).rows[0];requireValue(before,'RESOURCE_NOT_FOUND','工单不存在',404);
   requireValue(before.source_system==='PLATFORM','SOURCE_NOT_ALLOWED','仅手工订单可修改规格',422);
   for(const sid of ids){const spec=await this.catalog.getSpecification(ctx.actor.factory,sid,db);requireValue(spec.enabled||before.specification_ids.includes(sid),'SPEC_DISABLED','规格已停用',422)}
   const used=await db.query('SELECT 1 FROM m02.cable_spool WHERE work_order_id=$1 AND NOT(specification_id=ANY($2::text[])) LIMIT 1',[id,ids]);requireValue(!used.rowCount,'SPEC_IN_USE','已登记线缆的规格不能移除',409);
   const after=(await db.query('UPDATE m02.work_order SET specification_ids=$2 WHERE id=$1 RETURNING *',[id,ids])).rows[0];await this.identity.audit(ctx,'WORK_ORDER_SPECIFICATIONS_UPDATED','WORK_ORDER',id,{before:before.specification_ids,after:ids},db);return after;
  });
 }
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
