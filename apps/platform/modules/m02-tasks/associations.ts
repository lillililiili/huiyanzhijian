import {randomUUID} from 'node:crypto';
import {lock,transaction} from '../../infrastructure/db';
import {object,idField,textField,requireValue} from '../../infrastructure/errors';
import {IdentityApi,type Actor,type Context} from '../m00-identity/api';
import {TaskApi} from './api';

/** Changes business ownership only; capture bindings and measurement facts keep their identity. */
export class TaskAssociations {
 constructor(private tasks:TaskApi,private identity:IdentityApi){}
 async history(actor:Actor,id:string){
  idField(id);
  return transaction(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const task=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 AND factory_id=$2',[id,actor.factory])).rows[0];
   requireValue(task,'RESOURCE_NOT_FOUND','任务不存在',404);
   const changes=(await db.query('SELECT * FROM m02.task_association_change WHERE task_id=$1 AND factory_id=$2 ORDER BY association_version DESC',[id,actor.factory])).rows;
   return {task,changes};
  });
 }
 async correct(ctx:Context,id:string,b:any,key:string,version:string){
  idField(id);object(b,['target_spool_id','target_spool_version','reason']);idField(b.target_spool_id);textField(b.reason,1000);
  requireValue(typeof b.target_spool_version==='string'&&/^\d+$/.test(b.target_spool_version));
  requireValue(version,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);
  return this.tasks.command(ctx,key,{action:'task-reassociate',id,b,version},async db=>{
   await lock(db,'production:'+ctx.actor.factory);
   const task=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 AND factory_id=$2 FOR UPDATE',[id,ctx.actor.factory])).rows[0];
   requireValue(task,'RESOURCE_NOT_FOUND','任务不存在',404);
   requireValue(String(task.version)===version.replaceAll('"',''),'RESOURCE_VERSION_MISMATCH','任务已变化，请刷新后重新核对',412);
   requireValue(['CREATED','ENDED'].includes(task.state),'TASK_STATE_CONFLICT','仅待开始或已结束任务可更正；检测中请先结束',409);
   const pending=(await db.query('SELECT 1 FROM m02.production_encounter WHERE task_id=$1 AND exit_payload IS NULL',[id])).rowCount;
   requireValue(!pending,'TASK_ENCOUNTER_OPEN','此任务尚未收到出料事件，请先完成过料闭环',409);
   requireValue(b.target_spool_id!==task.spool_id,'TASK_ASSOCIATION_UNCHANGED','目标与当前盘相同',422);
   const contexts=(await db.query('SELECT s.id AS spool_id,s.spool_code,s.work_order_id,s.version AS spool_version,s.canonical_spool_id,w.external_code,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.factory_id=$1 AND s.id=ANY($2::text[])',[ctx.actor.factory,[task.spool_id,b.target_spool_id]])).rows;
   const before=contexts.find(s=>s.spool_id===task.spool_id),after=contexts.find(s=>s.spool_id===b.target_spool_id);
   requireValue(after,'RESOURCE_NOT_FOUND','目标盘不存在或无权访问',404);
   requireValue(String(after.spool_version)===b.target_spool_version,'RESOURCE_VERSION_MISMATCH','目标盘已变化，请刷新后重新核对',412);
   requireValue(!after.canonical_spool_id,'SPOOL_GROUPED','请选择归并后的主盘',409);
   requireValue(after.specification_id===task.specification_id,'TASK_BINDING_INVALID','目标盘与任务规格不一致',422);
   const mixed=(await db.query('SELECT 1 FROM m02.inspection_task WHERE factory_id=$1 AND spool_id IN(SELECT id FROM m02.cable_spool WHERE id=$2 OR canonical_spool_id=$2) AND data_environment<>$3 LIMIT 1',[ctx.actor.factory,after.spool_id,task.data_environment])).rowCount;
   requireValue(!mixed,'SOURCE_NOT_ALLOWED','目标盘不能混合真实与模拟任务',403);
   const updated=(await db.query('UPDATE m02.inspection_task SET spool_id=$2,work_order_id=$3,version=version+1,association_version=association_version+1 WHERE id=$1 RETURNING *',[id,after.spool_id,after.work_order_id])).rows[0];
   const change=(await db.query('INSERT INTO m02.task_association_change(id,factory_id,task_id,association_version,task_version,before_context,after_context,reason,actor_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[randomUUID(),ctx.actor.factory,id,updated.association_version,updated.version,JSON.stringify(before),JSON.stringify(after),b.reason.trim(),ctx.actor.id,ctx.requestId])).rows[0];
   await this.identity.audit(ctx,'TASK_REASSOCIATED','TASK',id,{change_id:change.id,before,after,reason:change.reason,association_version:updated.association_version},db);
   return {task:updated,change};
  });
 }
}
