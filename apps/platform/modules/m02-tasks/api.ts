import {randomUUID} from 'node:crypto';
import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {pool,transaction,lock,timestamp} from '../../infrastructure/db';
import {digest} from '../../infrastructure/canonical';
import {ApiError,object,requireValue,textField,idField} from '../../infrastructure/errors';
import {validate} from '../../infrastructure/schema';
import {IdentityApi,allow,deviceScope,type Context,type Actor} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {RuleApi,units} from '../m03-rules/api';
export class TaskApi{
 constructor(private identity:IdentityApi,private catalog:CatalogApi,private rules:RuleApi){}
 async command(ctx:Context,key:string,payload:unknown,fn:(db:PoolClient)=>Promise<any>){
  allow(ctx.actor,'task:write','USER');idField(key);const hash=digest(payload);
  return transaction(async db=>{await lock(db,`command:${ctx.actor.factory}:${ctx.actor.id}:${key}`);const old=await db.query('SELECT * FROM m02.command_receipt WHERE factory_id=$1 AND actor_id=$2 AND command_key=$3',[ctx.actor.factory,ctx.actor.id,key]);
   if(old.rowCount){requireValue(old.rows[0].payload_hash===hash,'IDEMPOTENCY_PAYLOAD_CONFLICT','同一幂等键的命令内容发生变化',409);return old.rows[0].response;}
   const result=await fn(db);await db.query('INSERT INTO m02.command_receipt(factory_id,actor_id,command_key,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[ctx.actor.factory,ctx.actor.id,key,hash,JSON.stringify(result)]);return result;
  });
 }
 async createWorkOrder(ctx:Context,b:any,key:string){object(b,['external_code','specification_id']);textField(b.external_code);idField(b.specification_id);return this.command(ctx,key,{action:'work-order',body:b},async db=>{await lock(db,'production:'+ctx.actor.factory);const spec=await this.catalog.getSpecification(ctx.actor.factory,b.specification_id,db);requireValue(spec.enabled,'SPEC_DISABLED','规格已停用，不能创建新工单',422);const id=randomUUID();const r=await db.query("INSERT INTO m02.work_order(id,factory_id,source_system,external_code,specification_id) VALUES($1,$2,'PLATFORM',$3,$4) RETURNING *",[id,ctx.actor.factory,b.external_code,b.specification_id]);await this.identity.audit(ctx,'WORK_ORDER_CREATED','WORK_ORDER',id,{},db);return r.rows[0];});}
 async createSpool(ctx:Context,b:any,key:string){object(b,['work_order_id','spool_code']);idField(b.work_order_id);textField(b.spool_code);return this.command(ctx,key,{action:'spool',body:b},async db=>{const wo=await db.query('SELECT 1 FROM m02.work_order WHERE id=$1 AND factory_id=$2 FOR KEY SHARE',[b.work_order_id,ctx.actor.factory]);requireValue(wo.rowCount,'RESOURCE_NOT_FOUND','工单不存在',404);const id=randomUUID();const r=await db.query('INSERT INTO m02.cable_spool(id,factory_id,work_order_id,spool_code) VALUES($1,$2,$3,$4) RETURNING *',[id,ctx.actor.factory,b.work_order_id,b.spool_code]);await this.identity.audit(ctx,'SPOOL_CREATED','SPOOL',id,{},db);return r.rows[0];});}
 async create(ctx:Context,b:any,key:string){
  return this.command(ctx,key,{action:'task-create',body:b},db=>this.createInTransaction(ctx,b,db));
 }
 async nextCode(db:PoolClient,factory:string){
  const timezone=await this.catalog.timezone(factory,db);
  const r=await db.query("INSERT INTO m02.daily_task_number(factory_id,day,value) VALUES($1,to_char(now() AT TIME ZONE $2,'YYYYMMDD'),1) ON CONFLICT(factory_id,day) DO UPDATE SET value=m02.daily_task_number.value+1 RETURNING day,value",[factory,timezone]);
  return r.rows[0].day+String(r.rows[0].value).padStart(4,'0');
 }
 async createInTransaction(ctx:Context,b:any,db:PoolClient,automatic=false){
  await lock(db,'production:'+ctx.actor.factory);
  object(b,['work_order_id','spool_id','specification_id','process_id','device_id','metric_code','recipe_version_id','planned_length_m']);for(const k of ['work_order_id','spool_id','specification_id','process_id','device_id'])idField(b[k]);if(b.recipe_version_id!==null)idField(b.recipe_version_id);
  requireValue((automatic&&b.planned_length_m===null)||typeof b.planned_length_m==='string'&&/^\d{1,14}(\.\d{1,10})?$/.test(b.planned_length_m)&&new Decimal(b.planned_length_m).gt(0));
   const device=await this.catalog.getDevice(ctx.actor.factory,b.device_id,db),spec=await this.catalog.getSpecification(ctx.actor.factory,b.specification_id,db);
   requireValue(device.enabled&&spec.enabled&&device.process_id===b.process_id&&device.metric_code===b.metric_code&&await this.catalog.applicable(spec.id,b.process_id,b.metric_code,db),'TASK_BINDING_INVALID','设备、规格、工序和指标不相容',422);
   const context=await db.query('SELECT s.spool_code,s.canonical_spool_id,w.external_code FROM m02.cable_spool s JOIN m02.work_order w ON s.work_order_id=w.id WHERE s.id=$1 AND w.id=$2 AND s.factory_id=$3 AND w.specification_id=$4',[b.spool_id,b.work_order_id,ctx.actor.factory,b.specification_id]);requireValue(context.rowCount,'TASK_BINDING_INVALID','工单与盘号或规格不一致',422);
   requireValue(!context.rows[0].canonical_spool_id,'SPOOL_GROUPED','请向主盘分配新任务',409);
   const mixed=await db.query('SELECT 1 FROM m02.inspection_task WHERE spool_id IN(SELECT id FROM m02.cable_spool WHERE id=$1 OR canonical_spool_id=$1) AND data_environment<>$2',[b.spool_id,device.data_environment]);requireValue(!mixed.rowCount,'SOURCE_NOT_ALLOWED','同一盘不能混合真实与模拟来源',403);
   const rule=await this.rules.getSnapshot(ctx.actor.factory,b.recipe_version_id,b.metric_code,device.data_environment,db,b.specification_id);const id=randomUUID(),code=await this.nextCode(db,ctx.actor.factory);
   const r=await db.query(`INSERT INTO m02.inspection_task(id,factory_id,task_code,work_order_id,spool_id,device_id,process_id,specification_id,metric_code,recipe_version_id,planned_length_m,data_environment,state,rule_snapshot,context_snapshot) VALUES($1,$2,$14,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CREATED',$12,$13) RETURNING *`,[id,ctx.actor.factory,b.work_order_id,b.spool_id,b.device_id,b.process_id,b.specification_id,b.metric_code,b.recipe_version_id,b.planned_length_m,device.data_environment,JSON.stringify(rule),JSON.stringify({device,specification:spec,...context.rows[0]}),code]);
   await this.identity.audit(ctx,'TASK_CREATED','TASK',id,{},db);return r.rows[0];
 }
 async get(actor:Actor,id:string){const r=await pool.query('SELECT * FROM m02.inspection_task WHERE id=$1 AND factory_id=$2',[id,actor.factory]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','任务不存在');return r.rows[0];}
 // Public read models for M04; all association SQL stays in M02.
 async associationRevision(actor:Actor,db:Pick<PoolClient,'query'>=pool){return (await db.query('SELECT count(*)::text AS revision FROM m02.task_association_change WHERE factory_id=$1',[actor.factory])).rows[0].revision;}
 async businessContexts(actor:Actor,ids:string[],db:Pick<PoolClient,'query'>=pool){
  return (await db.query(`SELECT t.id AS task_id,t.task_code,t.spool_id,t.work_order_id,t.original_spool_id,t.original_work_order_id,t.association_version,t.context_snapshot->>'spool_code' AS original_spool_code,s.spool_code,w.external_code FROM m02.inspection_task t JOIN m02.cable_spool s ON s.id=t.spool_id JOIN m02.work_order w ON w.id=t.work_order_id WHERE t.factory_id=$1 AND t.id=ANY($2::text[])`,[actor.factory,ids])).rows;
 }
 async taskIdsForProcess(actor:Actor,process:string,db:Pick<PoolClient,'query'>=pool){
  idField(process);return (await db.query('SELECT id FROM m02.inspection_task WHERE factory_id=$1 AND process_id=$2 ORDER BY id',[actor.factory,process])).rows.map(t=>t.id as string);
 }
 async spoolScope(actor:Actor,id:string,db:Pick<PoolClient,'query'>=pool){
  idField(id);
  const selected=(await db.query('SELECT * FROM m02.cable_spool WHERE factory_id=$1 AND id=$2',[actor.factory,id])).rows[0];
  requireValue(selected,'RESOURCE_NOT_FOUND','线缆不存在或无权访问',404);
  const root=selected.canonical_spool_id||selected.id;
  const members=(await db.query('SELECT s.*,w.external_code,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.factory_id=$1 AND (s.id=$2 OR s.canonical_spool_id=$2) ORDER BY s.id',[actor.factory,root])).rows;
  const tasks=(await db.query('SELECT * FROM m02.inspection_task WHERE factory_id=$1 AND spool_id=ANY($2::text[]) ORDER BY created_at,id',[actor.factory,members.map(s=>s.id)])).rows;
  return {requested_id:id,root_id:root,members,tasks,scope_hash:digest({members:members.map(s=>[s.id,s.version,s.canonical_spool_id]),tasks:tasks.map(t=>[t.id,t.spool_id,t.association_version])})};
 }
 async list(actor:Actor,type:'work_order'|'cable_spool'|'inspection_task',limit:number,after:string){return (await pool.query(`SELECT * FROM m02.${type} WHERE factory_id=$1 AND ($2='' OR id>$2) ORDER BY id LIMIT $3`,[actor.factory,after,limit])).rows;}
 async transition(ctx:Context,id:string,action:'start'|'end',b:any,key:string,version:string){
  object(b,action==='end'?['reason']:[]);if(action==='end')textField(b.reason,1000);
  requireValue(version,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);
  return this.command(ctx,key,{action,id,body:b,version},async db=>{
   return this.transitionInTransaction(ctx,id,action,b,version,db);
  });
 }
 async transitionInTransaction(ctx:Context,id:string,action:'start'|'end',b:any,version:string,db:PoolClient){
  await lock(db,'production:'+ctx.actor.factory);
   const found=await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 AND factory_id=$2 FOR UPDATE',[id,ctx.actor.factory]);requireValue(found.rowCount,'RESOURCE_NOT_FOUND','任务不存在',404);const task=found.rows[0];requireValue(String(task.version)===version.replaceAll('"',''),'RESOURCE_VERSION_MISMATCH','任务已变化，请重新读取',412);
   requireValue(task.state===(action==='start'?'CREATED':'RUNNING'),'TASK_STATE_CONFLICT','当前状态不能执行此操作',409);await lock(db,'device-task:'+task.device_id);
   if(action==='start'){
    const spec=await this.catalog.getSpecification(task.factory_id,task.specification_id,db);requireValue(spec.enabled,'SPEC_DISABLED','规格已停用，不能启动新检测',422);const d=await this.catalog.getDevice(task.factory_id,task.device_id,db);requireValue(d.enabled,'TASK_BINDING_INVALID','设备已停用',422);
    const occupied=await db.query("SELECT 1 FROM m02.inspection_task WHERE device_id=$1 AND state='RUNNING'",[task.device_id]);requireValue(!occupied.rowCount,'DEVICE_OCCUPIED','设备已有运行任务',409);
   }
   const next=await db.query(`UPDATE m02.inspection_task SET state=$2,version=version+1,${action==='start'?'started_at=now()':'ended_at=now(),end_reason=$3'} WHERE id=$1 RETURNING *`,action==='start'?[id,'RUNNING']:[id,'ENDED',b.reason]);
   await db.query('UPDATE m02.plan_item SET last_error=NULL WHERE task_id=$1',[id]);
   if(action==='start'){
    const seq=await db.query('SELECT COALESCE(MAX(binding_version),0)+1 AS v FROM m02.task_device_binding WHERE device_id=$1',[task.device_id]);const bid=randomUUID();
    const assignment:any={binding_id:bid,binding_version:seq.rows[0].v,task_id:id,task_version:next.rows[0].version,task_state:'RUNNING',factory_id:task.factory_id,spool_id:task.spool_id,process_id:task.process_id,specification_id:task.specification_id,metric_code:task.metric_code,unit:task.rule_snapshot.parameters?.unit||units[task.metric_code],recipe_version_id:task.recipe_version_id,evaluation_policy:task.rule_snapshot.approval_state==='UNAPPROVED'?'VALIDATE_ONLY':'EVALUATE_APPROVED',rule_snapshot:task.rule_snapshot};assignment.snapshot_hash=digest(assignment);validate('Assignment',assignment);
    await db.query('INSERT INTO m02.task_device_binding(id,task_id,device_id,factory_id,binding_version,assignment,snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[bid,id,task.device_id,task.factory_id,assignment.binding_version,JSON.stringify(assignment),assignment.snapshot_hash]);
   }
   await db.query('INSERT INTO m02.task_transition(id,task_id,from_state,to_state,actor_id,request_id,reason,task_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),id,task.state,next.rows[0].state,ctx.actor.id,ctx.requestId,b.reason||null,next.rows[0].version]);await this.identity.audit(ctx,'TASK_'+action.toUpperCase(),'TASK',id,{version:next.rows[0].version},db);return next.rows[0];
 }
 async assignment(actor:Actor,device:string){deviceScope(actor,device);const r=await pool.query("SELECT b.assignment FROM m02.task_device_binding b JOIN m02.inspection_task t ON t.id=b.task_id WHERE b.factory_id=$1 AND b.device_id=$2 AND t.state='RUNNING' ORDER BY b.binding_version DESC LIMIT 1",[actor.factory,device]);return {device_id:device,server_time:new Date().toISOString(),assignment:r.rows[0]?.assignment||null};}
 async ack(ctx:Context,device:string,b:any){validate('AssignmentAck',b);deviceScope(ctx.actor,device);if(b.first_capture_sequence!==null)requireValue(BigInt(b.first_capture_sequence)<=18446744073709551615n);return transaction(async db=>{
  await lock(db,'ack:'+device+':'+b.ack_id);const old=await db.query('SELECT *, '+timestamp('recorded_at')+' AS recorded FROM m02.binding_ack WHERE device_id=$1 AND id=$2',[device,b.ack_id]);const hash=digest(b);
  if(old.rowCount){requireValue(old.rows[0].payload_hash===hash,'ACK_PAYLOAD_CONFLICT','确认键内容冲突',409);return this.ackResult(old.rows[0],true);}
  const current=await db.query("SELECT b.* FROM m02.task_device_binding b JOIN m02.inspection_task t ON t.id=b.task_id WHERE b.id=$1 AND b.device_id=$2 AND b.factory_id=$3 AND t.state='RUNNING' FOR UPDATE OF t",[b.binding_id,device,ctx.actor.factory]);requireValue(current.rowCount&&current.rows[0].binding_version===b.binding_version,'BINDING_SUPERSEDED','绑定已经改变',409);requireValue(current.rows[0].snapshot_hash===b.snapshot_hash,'SNAPSHOT_HASH_MISMATCH','任务快照摘要不一致',422);
  if(b.effective_at)requireValue(Date.parse(b.effective_at)<=Date.now()+5000,'BINDING_INVALID','生效时间超出容差',422);
  const r=await db.query(`INSERT INTO m02.binding_ack(id,factory_id,device_id,binding_id,payload_hash,payload,result,capture_session_id,first_capture_sequence,effective_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *,${timestamp('recorded_at')} AS recorded`,[b.ack_id,ctx.actor.factory,device,b.binding_id,hash,JSON.stringify(b),b.result,b.capture_session_id,b.first_capture_sequence,b.effective_at]);await this.identity.audit(ctx,'ASSIGNMENT_ACK','BINDING',b.binding_id,{result:b.result},db);return this.ackResult(r.rows[0],false);
 });}
 private ackResult(row:any,duplicate:boolean){return {ack_id:row.id,binding_id:row.binding_id,binding_version:row.payload.binding_version,result:row.result,recorded_at:row.recorded,duplicate};}
 async verifyRecord(factory:string,record:any){
  if(!record.binding_id||!record.task_id)return null;
  const r=await pool.query(`SELECT b.assignment,t.started_at,t.ended_at,a.effective_at FROM m02.task_device_binding b JOIN m02.inspection_task t ON t.id=b.task_id JOIN LATERAL (SELECT * FROM m02.binding_ack WHERE factory_id=$1 AND device_id=$2 AND capture_session_id=$3 AND result='APPLIED' AND first_capture_sequence<=$4 ORDER BY first_capture_sequence DESC,recorded_at DESC LIMIT 1) a ON a.binding_id=b.id WHERE b.id=$5 AND b.task_id=$6 AND b.binding_version=$7 AND b.device_id=$2 AND b.factory_id=$1 AND a.effective_at<=$8::timestamptz AND t.started_at<=$8::timestamptz AND (t.ended_at IS NULL OR $8::timestamptz<=t.ended_at)`,[factory,record.device_id,record.capture_session_id,record.capture_sequence,record.binding_id,record.task_id,record.binding_version,record.sample_time]);
  if(!r.rowCount)return null;const assignment=r.rows[0].assignment;if(assignment.recipe_version_id!==record.recipe_version_id||assignment.metric_code!==record.values[0].metric_code)return null;return assignment;
 }
}
