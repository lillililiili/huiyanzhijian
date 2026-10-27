import {randomUUID} from 'node:crypto';
import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {pool,transaction,lock} from '../../infrastructure/db';
import {digest} from '../../infrastructure/canonical';
import {ApiError,object,idField,textField,requireValue} from '../../infrastructure/errors';
import {IdentityApi,deviceScope,type Actor,type Context} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {RuleApi} from '../m03-rules/api';
import {TaskApi} from './api';

function matchVersion(actual:unknown,version:string){requireValue(version,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);requireValue(String(actual)===version.replaceAll('"',''),'RESOURCE_VERSION_MISMATCH','资料已变化，请刷新后重试',412);}
function meter(value:any){if(value===null)return;object(value,['counter_id','value_m']);idField(value.counter_id);requireValue(typeof value.value_m==='string'&&/^\d{1,14}(\.\d{1,10})?$/.test(value.value_m));}
function eventIdentity(b:any){const {event_id,connection_id,...rest}=b;return rest;}

/** M02 owns plans, physical encounter identity and display grouping; raw measurements remain M04 facts. */
export class ProductionApi{
 constructor(private tasks:TaskApi,private identity:IdentityApi,private catalog:CatalogApi,private rules:RuleApi){}
 async createPlan(ctx:Context,b:any,key:string){
  object(b,['name','items']);textField(b.name);requireValue(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=50);
  const signatures=new Set<string>();for(const item of b.items){object(item,['work_order_id','spool_id','specification_id','process_id','device_id','metric_code','recipe_version_id','planned_length_m']);for(const k of ['work_order_id','spool_id','specification_id','process_id','device_id'])idField(item[k]);const sig=item.spool_id+':'+item.device_id;requireValue(!signatures.has(sig),'PLAN_DUPLICATE_ITEM','同一计划同盘同设备只允许一个执行项');signatures.add(sig);}
  return this.tasks.command(ctx,key,{action:'plan-create',b},async db=>{
   await lock(db,'production:'+ctx.actor.factory);
   // Plan requests are JSON, so validate/lock their order references explicitly.
   for(const orderId of new Set<string>(b.items.map((i:any)=>i.work_order_id))){
    const order=await db.query('SELECT id FROM m02.work_order WHERE id=$1 AND factory_id=$2 FOR KEY SHARE',[orderId,ctx.actor.factory]);
    requireValue(order.rowCount,'RESOURCE_NOT_FOUND','计划引用的工单不存在或无权访问',404);
   }
   const id=randomUUID();await db.query('INSERT INTO m02.batch_plan(id,factory_id,name,created_by) VALUES($1,$2,$3,$4)',[id,ctx.actor.factory,b.name,ctx.actor.id]);
   for(let i=0;i<b.items.length;i++)await db.query('INSERT INTO m02.plan_item(id,plan_id,ordinal,request) VALUES($1,$2,$3,$4)',[randomUUID(),id,i+1,JSON.stringify(b.items[i])]);
   await this.identity.audit(ctx,'PLAN_CREATED','PLAN',id,{items:b.items.length},db);return {id,name:b.name};
  });
 }
 async plans(actor:Actor){return (await pool.query(`SELECT p.*,count(i.id)::int AS item_count,count(i.id) FILTER(WHERE i.removed_at IS NOT NULL)::int AS removed_count,count(i.id) FILTER(WHERE i.last_error IS NOT NULL AND i.removed_at IS NULL)::int AS failed_count,count(DISTINCT i.request->>'spool_id') FILTER(WHERE i.removed_at IS NULL)::int AS spool_count,count(t.id) FILTER(WHERE t.state='ENDED' AND i.removed_at IS NULL)::int AS ended_count,count(t.id) FILTER(WHERE t.state='RUNNING')::int AS running_count FROM m02.batch_plan p LEFT JOIN m02.plan_item i ON i.plan_id=p.id LEFT JOIN m02.inspection_task t ON t.id=i.task_id WHERE p.factory_id=$1 GROUP BY p.id ORDER BY p.created_at DESC,p.id LIMIT 500`,[actor.factory])).rows;}
 async plan(actor:Actor,id:string,db:PoolClient|typeof pool=pool){
  const p=await db.query('SELECT * FROM m02.batch_plan WHERE id=$1 AND factory_id=$2',[id,actor.factory]);requireValue(p.rowCount,'RESOURCE_NOT_FOUND','计划不存在',404);
  const items=(await db.query(`SELECT i.*,to_jsonb(t) AS task FROM m02.plan_item i LEFT JOIN m02.inspection_task t ON t.id=i.task_id WHERE i.plan_id=$1 ORDER BY i.ordinal`,[id])).rows;
  return {...p.rows[0],items};
 }
 async executePlan(ctx:Context,id:string,action:'generate'|'start'|'remove',b:any,key:string){
  object(b,action==='remove'?['item_id','reason']:[],action==='remove'?[]:['item_id']);if(b.item_id)idField(b.item_id);if(action==='remove')textField(b.reason,1000);
  return this.tasks.command(ctx,key,{action:'plan-'+action,id,b},async db=>{
   await lock(db,'plan:'+id);const plan=await this.plan(ctx.actor,id,db);const selected=plan.items.filter((i:any)=>!b.item_id||i.id===b.item_id);requireValue(selected.length,'RESOURCE_NOT_FOUND','计划项不存在',404);
   const results=[];
   for(const item of selected){
    if(item.removed_at){results.push({item_id:item.id,status:'REMOVED'});continue;}
    await db.query('SAVEPOINT plan_item');
    try{
     let task=item.task;
     if(action==='generate'&&!task){task=await this.tasks.createInTransaction(ctx,item.request,db);await db.query('UPDATE m02.plan_item SET task_id=$2 WHERE id=$1',[item.id,task.id]);}
     if(action==='start'){
      requireValue(task,'PLAN_ITEM_NOT_GENERATED','请先生成此项任务',409);
      if(task.state==='CREATED')task=await this.tasks.transitionInTransaction(ctx,task.id,'start',{},String(task.version),db);
      else requireValue(['RUNNING','ENDED'].includes(task.state),'TASK_STATE_CONFLICT','已取消任务不能开始',409);
     }
     if(action==='remove'){
      if(task){const row=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 FOR UPDATE',[task.id])).rows[0];requireValue(row.state==='CREATED','TASK_STATE_CONFLICT','只能移除未开始项',409);await db.query("UPDATE m02.inspection_task SET state='CANCELLED',version=version+1,end_reason=$2 WHERE id=$1",[task.id,b.reason]);await db.query("INSERT INTO m02.task_transition(id,task_id,from_state,to_state,actor_id,request_id,reason,task_version) VALUES($1,$2,'CREATED','CANCELLED',$3,$4,$5,$6)",[randomUUID(),task.id,ctx.actor.id,ctx.requestId,b.reason,String(BigInt(row.version)+1n)]);}
      await db.query('UPDATE m02.plan_item SET removed_at=now(),remove_reason=$2 WHERE id=$1',[item.id,b.reason]);
     }
     if(action!=='generate'||!item.task)await db.query('UPDATE m02.plan_item SET last_error=NULL WHERE id=$1',[item.id]);await this.identity.audit(ctx,'PLAN_ITEM_'+action.toUpperCase(),'PLAN',id,{item_id:item.id,task_id:task?.id,reason:b.reason},db);
     results.push({item_id:item.id,task_id:task?.id,status:action==='remove'?'REMOVED':task?.state});await db.query('RELEASE SAVEPOINT plan_item');
    }catch(e){await db.query('ROLLBACK TO SAVEPOINT plan_item');if(!(e instanceof ApiError))throw e;const error={code:e.code,message:e.message};await db.query('UPDATE m02.plan_item SET last_error=$2 WHERE id=$1',[item.id,JSON.stringify(error)]);results.push({item_id:item.id,status:'FAILED',error});}
   }
   return {id,results};
  });
 }
 async profiles(actor:Actor){return (await pool.query('SELECT * FROM m02.discovery_profile WHERE factory_id=$1 ORDER BY device_id',[actor.factory])).rows;}
 async configure(ctx:Context,deviceId:string,b:any,key:string,version:string){
  object(b,['enabled','specification_id','recipe_version_id']);requireValue(typeof b.enabled==='boolean');idField(deviceId);idField(b.specification_id);if(b.recipe_version_id!==null)idField(b.recipe_version_id);
  return this.tasks.command(ctx,key,{action:'discovery-config',deviceId,b,version},async db=>{
   await lock(db,'production:'+ctx.actor.factory);await lock(db,'discovery-profile:'+deviceId);const previous=(await db.query('SELECT * FROM m02.discovery_profile WHERE factory_id=$1 AND device_id=$2',[ctx.actor.factory,deviceId])).rows[0];matchVersion(previous?.version||0,version);
   const d=await this.catalog.getDevice(ctx.actor.factory,deviceId,db),s=await this.catalog.getSpecification(ctx.actor.factory,b.specification_id,db);requireValue(d.enabled&&s.enabled&&await this.catalog.applicable(s.id,d.process_id,d.metric_code,db),'TASK_BINDING_INVALID','设备与规格不适用',422);await this.rules.getSnapshot(ctx.actor.factory,b.recipe_version_id,d.metric_code,d.data_environment,db,b.specification_id);
   const row=await db.query('INSERT INTO m02.discovery_profile(factory_id,device_id,enabled,specification_id,recipe_version_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(factory_id,device_id) DO UPDATE SET enabled=$3,specification_id=$4,recipe_version_id=$5,version=m02.discovery_profile.version+1 RETURNING *',[ctx.actor.factory,deviceId,b.enabled,b.specification_id,b.recipe_version_id]);await this.identity.audit(ctx,'DISCOVERY_CONFIGURED','DEVICE',deviceId,b,db);return row.rows[0];
  });
 }
 async productionEvent(ctx:Context,b:any){
  object(b,['schema_version','event_id','encounter_id','device_id','connection_id','phase','occurred_at','meter'],['spool_id','task_id','material_ref']);
  requireValue(b.schema_version==='1.0'&&['ENTER','EXIT'].includes(b.phase));for(const k of ['event_id','encounter_id','device_id','connection_id'])idField(b[k]);for(const k of ['spool_id','task_id'])if(b[k])idField(b[k]);if(b.material_ref)textField(b.material_ref);meter(b.meter);
  requireValue(typeof b.occurred_at==='string'&&/T.*(Z|[+-]\d\d:\d\d)$/.test(b.occurred_at)&&Number.isFinite(Date.parse(b.occurred_at)));deviceScope(ctx.actor,b.device_id);
  const d=await this.catalog.getDevice(ctx.actor.factory,b.device_id);deviceScope(ctx.actor,b.device_id,d.data_environment);requireValue(d.enabled,'TASK_BINDING_INVALID','设备已停用',422);
  const {connection_id,...stable}=b,hash=digest(stable);
  return transaction(async db=>{
   // Serialize production identity changes before device/task locks, including manual grouping.
   await lock(db,'production:'+ctx.actor.factory);await lock(db,'event:'+b.device_id+':'+b.event_id);
   const old=(await db.query('SELECT * FROM m02.production_event WHERE factory_id=$1 AND device_id=$2 AND event_id=$3',[ctx.actor.factory,b.device_id,b.event_id])).rows[0];
   if(old){requireValue(old.payload_hash===hash,'EVENT_PAYLOAD_CONFLICT','同一事件编号内容不同',409);return {...old.response,duplicate:true};}
   let encounter=(await db.query('SELECT * FROM m02.production_encounter WHERE factory_id=$1 AND device_id=$2 AND encounter_id=$3',[ctx.actor.factory,b.device_id,b.encounter_id])).rows[0];let task:any;
   const previous=encounter?.[b.phase==='ENTER'?'enter_payload':'exit_payload'];
   if(previous){requireValue(digest(eventIdentity(previous))===digest(eventIdentity(b)),'ENCOUNTER_PAYLOAD_CONFLICT','同次过料事件内容变化，请核对事件身份',409);task=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1',[encounter.task_id])).rows[0];}
   else{
    requireValue(Math.abs(Date.now()-Date.parse(b.occurred_at))<=300000,'EVENT_TIME_OUT_OF_RANGE','新进出料事件必须在服务器时间前后5分钟内；离线派工尚未开放',422);
    if(b.phase==='ENTER')task=await this.enter(ctx,b,d,db);
    else{
     requireValue(encounter,'ENCOUNTER_NOT_FOUND','未找到进料事件，不能结束其他任务',409);requireValue(Date.parse(b.occurred_at)>=Date.parse(encounter.enter_payload.occurred_at),'EVENT_ORDER_INVALID','出料早于进料',422);
     task=(await db.query('SELECT * FROM m02.inspection_task WHERE id=$1 FOR UPDATE',[encounter.task_id])).rows[0];
     if(b.task_id)requireValue(b.task_id===task.id,'TASK_BINDING_INVALID','出料任务不匹配',422);if(b.spool_id)requireValue(b.spool_id===task.spool_id,'TASK_BINDING_INVALID','出料盘号不匹配',422);
     if(task.state==='RUNNING')task=await this.tasks.transitionInTransaction(ctx,task.id,'end',{reason:'设备出料事件 '+b.event_id},String(task.version),db);
     requireValue(task.state==='ENDED','TASK_STATE_CONFLICT','此任务不能完成出料',409);
     const a=encounter.enter_payload.meter,z=b.meter;let length=null,status='UNKNOWN';
     if(a&&z){if(a.counter_id===z.counter_id&&new Decimal(z.value_m).gte(a.value_m)){length=new Decimal(z.value_m).minus(a.value_m).toFixed();status='REPORTED_UNVERIFIED';}else status='COUNTER_CHANGED';}
     task=(await db.query('UPDATE m02.inspection_task SET reported_length_m=$2,length_status=$3,version=version+1 WHERE id=$1 RETURNING *',[task.id,length,status])).rows[0];
     await db.query('UPDATE m02.production_encounter SET exit_payload=$4 WHERE factory_id=$1 AND device_id=$2 AND encounter_id=$3',[ctx.actor.factory,b.device_id,b.encounter_id,JSON.stringify(b)]);
    }
   }
   const response={event_id:b.event_id,encounter_id:b.encounter_id,task_id:task.id,task_code:task.task_code,spool_id:task.spool_id,state:task.state,reported_length_m:task.reported_length_m,length_status:task.length_status,duplicate:!!previous};
   await db.query('INSERT INTO m02.production_event(factory_id,device_id,event_id,payload_hash,payload,response) VALUES($1,$2,$3,$4,$5,$6)',[ctx.actor.factory,b.device_id,b.event_id,hash,JSON.stringify(b),JSON.stringify(response)]);await this.identity.audit(ctx,'PRODUCTION_'+b.phase,'TASK',task.id,{event_id:b.event_id,encounter_id:b.encounter_id},db);return response;
  });
 }
 private async enter(ctx:Context,b:any,d:any,db:PoolClient){
  const profile=(await db.query('SELECT * FROM m02.discovery_profile WHERE factory_id=$1 AND device_id=$2',[ctx.actor.factory,b.device_id])).rows[0];requireValue(profile?.enabled,'AUTO_DISCOVERY_DISABLED','此设备未启用自动发现',409);
  let spoolId=b.spool_id,task:any;
  if(b.task_id){task=(await db.query('SELECT * FROM m02.inspection_task WHERE factory_id=$1 AND id=$2 FOR UPDATE',[ctx.actor.factory,b.task_id])).rows[0];requireValue(task&&task.device_id===d.id&&task.specification_id===profile.specification_id,'TASK_BINDING_INVALID','指定任务与设备/规格不匹配',422);requireValue(!spoolId||spoolId===task.spool_id,'TASK_BINDING_INVALID','指定任务与盘不匹配',422);spoolId=task.spool_id;}
  if(b.material_ref){const known=(await db.query('SELECT spool_id FROM m02.material_identity WHERE factory_id=$1 AND data_environment=$2 AND material_ref=$3',[ctx.actor.factory,d.data_environment,b.material_ref])).rows[0];if(known){requireValue(!spoolId||spoolId===known.spool_id,'MATERIAL_IDENTITY_CONFLICT','物料标识已关联其他盘',409);spoolId=known.spool_id;}}
  if(!spoolId){
   const timezone=await this.catalog.timezone(ctx.actor.factory,db),day=(await db.query("SELECT to_char(now() AT TIME ZONE $1,'YYYYMMDD') AS day",[timezone])).rows[0].day;
   const code='AUTO-'+day+'-'+digest([d.line_id,profile.specification_id,d.data_environment]).slice(0,16);
   const wo=(await db.query("INSERT INTO m02.work_order(id,factory_id,source_system,external_code,specification_id) VALUES($1,$2,'AUTO',$3,$4) ON CONFLICT(factory_id,source_system,external_code) DO UPDATE SET external_code=excluded.external_code RETURNING *",[randomUUID(),ctx.actor.factory,code,profile.specification_id])).rows[0];
   spoolId=randomUUID();await db.query('INSERT INTO m02.cable_spool(id,factory_id,work_order_id,spool_code) VALUES($1,$2,$3,$4)',[spoolId,ctx.actor.factory,wo.id,'临时盘-'+spoolId.slice(0,8)]);
  }
  const spool=(await db.query('SELECT s.*,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.id=$1 AND s.factory_id=$2',[spoolId,ctx.actor.factory])).rows[0];requireValue(spool&&spool.specification_id===profile.specification_id,'TASK_BINDING_INVALID','盘规格不匹配',422);requireValue(!spool.canonical_spool_id,'SPOOL_GROUPED','请使用归并后的主盘ID',409);
  const foreign=(await db.query('SELECT 1 FROM m02.inspection_task WHERE spool_id=$1 AND data_environment<>$2',[spoolId,d.data_environment])).rowCount;requireValue(!foreign,'SOURCE_NOT_ALLOWED','同一盘不能混合真实与模拟来源',403);
  if(!task){const candidates=(await db.query("SELECT * FROM m02.inspection_task WHERE spool_id=$1 AND device_id=$2 AND state IN('CREATED','RUNNING') ORDER BY created_at FOR UPDATE",[spoolId,d.id])).rows;requireValue(candidates.length<=1,'TASK_SELECTION_REQUIRED','此盘存在多个候选任务，请明确task_id',409);task=candidates[0];}
  if(!task){task=await this.tasks.createInTransaction(ctx,{work_order_id:spool.work_order_id,spool_id:spoolId,specification_id:profile.specification_id,process_id:d.process_id,device_id:d.id,metric_code:d.metric_code,recipe_version_id:profile.recipe_version_id,planned_length_m:null},db,true);task=(await db.query("UPDATE m02.inspection_task SET creation_source='AUTO' WHERE id=$1 RETURNING *",[task.id])).rows[0];}
  const existing=(await db.query('SELECT 1 FROM m02.production_encounter WHERE task_id=$1',[task.id])).rowCount;requireValue(!existing,'TASK_ENCOUNTER_CONFLICT','任务已关联其他过料，请结束并新建任务',409);
  if(task.state==='CREATED')task=await this.tasks.transitionInTransaction(ctx,task.id,'start',{},String(task.version),db);requireValue(task.state==='RUNNING','TASK_STATE_CONFLICT','任务已结束或取消',409);
  if(b.material_ref)await db.query('INSERT INTO m02.material_identity(factory_id,data_environment,material_ref,spool_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[ctx.actor.factory,d.data_environment,b.material_ref,spoolId]);
  await db.query('INSERT INTO m02.production_encounter(factory_id,device_id,encounter_id,task_id,enter_payload) VALUES($1,$2,$3,$4,$5)',[ctx.actor.factory,d.id,b.encounter_id,task.id,JSON.stringify(b)]);return task;
 }
 async editSpool(ctx:Context,id:string,b:any,key:string,version:string){
  object(b,['spool_code','canonical_spool_id','reason']);textField(b.spool_code);textField(b.reason,1000);if(b.canonical_spool_id!==null)idField(b.canonical_spool_id);
  return this.tasks.command(ctx,key,{action:'spool-edit',id,b,version},async db=>{
   await lock(db,'production:'+ctx.actor.factory);const row=(await db.query('SELECT s.*,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.id=$1 AND s.factory_id=$2 FOR UPDATE OF s',[id,ctx.actor.factory])).rows[0];requireValue(row,'RESOURCE_NOT_FOUND','盘不存在',404);matchVersion(row.version,version);
   if(b.canonical_spool_id!==row.canonical_spool_id){
    requireValue(b.canonical_spool_id!==id,'SPOOL_GROUP_INVALID','不能归并到自身',422);
    const children=(await db.query('SELECT 1 FROM m02.cable_spool WHERE canonical_spool_id=$1',[id])).rowCount;requireValue(!children,'SPOOL_GROUP_INVALID','请先解除子盘归并',409);
    if(b.canonical_spool_id){const target=(await db.query('SELECT s.*,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.id=$1 AND s.factory_id=$2',[b.canonical_spool_id,ctx.actor.factory])).rows[0];requireValue(target&&!target.canonical_spool_id&&target.specification_id===row.specification_id,'SPOOL_GROUP_INVALID','目标须是同规格主盘',422);}
    const ids=[id,row.canonical_spool_id,b.canonical_spool_id].filter(Boolean);const related=(await db.query('SELECT id FROM m02.cable_spool WHERE id=ANY($1) OR canonical_spool_id=ANY($1)',[ids])).rows.map(x=>x.id);
    const facts=(await db.query('SELECT state,data_environment FROM m02.inspection_task WHERE spool_id=ANY($1) FOR UPDATE',[related])).rows;requireValue(!facts.some(t=>t.state==='RUNNING'),'SPOOL_BUSY','请结束关联盘的运行任务后归并',409);requireValue(new Set(facts.map(t=>t.data_environment)).size<=1,'SOURCE_NOT_ALLOWED','不能合并不同来源环境',403);
   }
   const updated=(await db.query('UPDATE m02.cable_spool SET spool_code=$2,canonical_spool_id=$3,version=version+1 WHERE id=$1 RETURNING *',[id,b.spool_code,b.canonical_spool_id])).rows[0];await this.identity.audit(ctx,'SPOOL_UPDATED','SPOOL',id,{before:row,after:updated,reason:b.reason},db);return updated;
  });
 }
 async taskDetail(actor:Actor,id:string){
  const task=await this.tasks.get(actor,id);const [transitions,encounter,plan]=await Promise.all([pool.query('SELECT * FROM m02.task_transition WHERE task_id=$1 ORDER BY task_version',[id]),pool.query('SELECT * FROM m02.production_encounter WHERE task_id=$1',[id]),pool.query('SELECT p.id,p.name,i.id AS item_id FROM m02.batch_plan p JOIN m02.plan_item i ON i.plan_id=p.id WHERE i.task_id=$1',[id])]);return {task,transitions:transitions.rows,encounter:encounter.rows[0]||null,plan:plan.rows[0]||null};
 }
 async search(actor:Actor,q:Record<string,string>){return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return this.searchInTransaction(actor,q,db);});}
 async searchInTransaction(actor:Actor,q:Record<string,string>,db:PoolClient){
  const page=Number(q.page||1),limit=Number(q.limit||20);requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000&&Number.isSafeInteger(limit)&&limit>0&&limit<=100);
  const values:any[]=[actor.factory],where=['t.factory_id=$1'];const add=(sql:string,value:any)=>{values.push(value);where.push(sql.replaceAll('?',`$${values.length}`));};
  if(q.q){textField(q.q,128);add("concat_ws(' ',t.task_code,s.spool_code,w.external_code,t.specification_id,p.name) ILIKE ?",'%'+q.q+'%');}
  for(const k of ['state','device_id','metric_code','specification_id','data_environment','creation_source','work_order_id'])if(q[k])add('t.'+k+'=?',q[k]);
  if(q.plan_id)add('p.id=?',q.plan_id);if(q.line_id)add("t.context_snapshot->'device'->>'line_id'=?",q.line_id);
  for(const k of ['from','to'])if(q[k]){requireValue(Number.isFinite(Date.parse(q[k]))&&/T.*(Z|[+-]\d\d:\d\d)$/.test(q[k]));add('t.created_at'+(k==='from'?'>=':'<')+'?::timestamptz',q[k]);}
  if(q.spool_id)add('COALESCE(s.canonical_spool_id,s.id)=?',q.spool_id);
  const from=`FROM m02.inspection_task t JOIN m02.cable_spool s ON s.id=t.spool_id JOIN m02.work_order w ON w.id=t.work_order_id LEFT JOIN m02.plan_item i ON i.task_id=t.id LEFT JOIN m02.batch_plan p ON p.id=i.plan_id WHERE ${where.join(' AND ')}`;

   const summary=(await db.query(`SELECT count(*)::int AS total,count(DISTINCT COALESCE(s.canonical_spool_id,s.id))::int AS spools,count(*) FILTER(WHERE t.state='RUNNING')::int AS running,count(*) FILTER(WHERE t.state='ENDED')::int AS ended,count(*) FILTER(WHERE t.state='CREATED')::int AS waiting ${from}`,values)).rows[0];
   const items=(await db.query(`SELECT t.*,s.spool_code AS current_spool_code,w.external_code AS current_order_code,COALESCE(s.canonical_spool_id,s.id) AS canonical_spool_id,p.id AS plan_id,p.name AS plan_name ${from} ORDER BY t.created_at DESC,t.id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,(page-1)*limit])).rows;return {items,...summary,page,limit,as_of:new Date().toISOString()};
 }
}
