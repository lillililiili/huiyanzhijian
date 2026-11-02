import {createHash} from 'node:crypto';
import {transaction,lock} from '../../infrastructure/db';
import {digest} from '../../infrastructure/canonical';
import {object,idField,requireValue} from '../../infrastructure/errors';
import {deviceScope,type Context,type Actor} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {TaskApi} from './api';
import {parseTaskBarcode} from './task-labels';

// Owns only M02 task/binding records. A scan is one atomic device transition.
export class ScanLifecycle {
 constructor(private tasks:TaskApi,private catalog:CatalogApi){}
 private check(actor:Actor,device:string,t:any,revision:string){
  requireValue(t,'RESOURCE_NOT_FOUND','任务不存在或无权访问',404);
  deviceScope(actor,device);deviceScope(actor,t.device_id,t.data_environment);
  requireValue(t.device_id===device,'LABEL_DEVICE_MISMATCH','任务码与本设备不匹配',409);
  requireValue(t.metric_code==='OVALITY'&&t.data_environment==='SIMULATED','LABEL_ADAPTER_UNAVAILABLE','此设备扫码适配未启用',409);
  requireValue(String(t.association_version)===revision,'LABEL_SUPERSEDED','任务归属已更正，请重新下载任务码',409);
  requireValue(['CREATED','RUNNING','ENDED'].includes(t.state),'TASK_STATE_CONFLICT','任务已取消，不能扫码采集',409);
  requireValue(Number(t.planned_length_m)>0&&Number(t.planned_length_m)<=1e8,'LABEL_LENGTH_REQUIRED','请先补齐有效计划长度',409);
 }
 async preview(actor:Actor,device:string,code:string){
  const p=parseTaskBarcode(code),t=await this.tasks.get(actor,p.id);this.check(actor,device,t,p.revision);
  const d=await this.catalog.getDevice(actor.factory,device);requireValue(d.enabled,'DEVICE_DISABLED','设备已停用',409);
  return {task_id:t.id,device_id:device,spool_id:t.spool_id,state:t.state,assignment:(await this.tasks.assignment(actor,device)).assignment};
 }
 async command(ctx:Context,device:string,action:'scan'|'stop',b:any){
  deviceScope(ctx.actor,device);
  const supported=await this.catalog.getDevice(ctx.actor.factory,device);requireValue(supported.metric_code==='OVALITY'&&supported.data_environment==='SIMULATED','LABEL_ADAPTER_UNAVAILABLE','此设备扫码适配未启用',409);
  object(b,action==='scan'?['command_id','barcode','expected_task_id','expected_binding_id']:['command_id','expected_task_id','expected_binding_id']);
  idField(b.command_id);for(const k of ['expected_task_id','expected_binding_id'])if(b[k]!==null)idField(b[k]);
  requireValue((b.expected_task_id===null)===(b.expected_binding_id===null),'INVALID_INPUT','任务与绑定必须同时提供');
  const parsed=action==='scan'?parseTaskBarcode(b.barcode):null,hash=digest({device,action,body:b});
  return transaction(async db=>{
   await lock(db,`command:${ctx.actor.factory}:${ctx.actor.id}:${b.command_id}`);
   const receipt=(await db.query('SELECT * FROM m02.command_receipt WHERE factory_id=$1 AND actor_id=$2 AND command_key=$3',[ctx.actor.factory,ctx.actor.id,b.command_id])).rows[0];
   if(receipt){requireValue(receipt.payload_hash===hash,'IDEMPOTENCY_PAYLOAD_CONFLICT','命令内容已变化',409);return receipt.response;}
   await lock(db,'production:'+ctx.actor.factory);
   let target:any;
   if(parsed){target=(await db.query('SELECT * FROM m02.inspection_task WHERE factory_id=$1 AND id=$2 FOR UPDATE',[ctx.actor.factory,parsed.id])).rows[0];this.check(ctx.actor,device,target,parsed.revision);}
   const current=(await db.query("SELECT t.*,b.id AS binding_id FROM m02.inspection_task t JOIN m02.task_device_binding b ON b.task_id=t.id WHERE t.factory_id=$1 AND t.device_id=$2 AND t.state='RUNNING' ORDER BY b.binding_version DESC LIMIT 1 FOR UPDATE OF t",[ctx.actor.factory,device])).rows[0];
   let alreadyEnded=false;
   if(action==='stop'&&!current&&b.expected_task_id){const prior=(await db.query("SELECT 1 FROM m02.inspection_task t JOIN m02.task_device_binding b ON b.task_id=t.id WHERE t.factory_id=$1 AND t.device_id=$2 AND t.id=$3 AND b.id=$4 AND t.state='ENDED'",[ctx.actor.factory,device,b.expected_task_id,b.expected_binding_id])).rowCount;alreadyEnded=!!prior;}
   requireValue(alreadyEnded||((current?.id??null)===b.expected_task_id&&(current?.binding_id??null)===b.expected_binding_id),'BINDING_SUPERSEDED','设备任务已变化，请刷新后重新扫码',409);
   if(target){const d=await this.catalog.getDevice(ctx.actor.factory,device,db);requireValue(d.enabled,'DEVICE_DISABLED','设备已停用',409);}
   let ended:any=null;
   if(current)ended=await this.tasks.transitionInTransaction(ctx,current.id,'end',{reason:action==='stop'?'边缘关机':'扫码开启独立采集，来源任务 '+target.task_code},String(current.version),db);
   if(target&&target.state!=='CREATED')target=await this.tasks.repeatScanInTransaction(ctx,target,db);
   if(target?.state==='CREATED')target=await this.tasks.transitionInTransaction(ctx,target.id,'start',{},String(target.version),db);
   let label:any=null;
   if(target){
    const a=(await db.query('SELECT assignment FROM m02.task_device_binding WHERE task_id=$1 ORDER BY binding_version DESC LIMIT 1',[target.id])).rows[0]?.assignment;
    requireValue(a,'BINDING_SUPERSEDED','任务缺少有效绑定',409);
    const c=(await this.tasks.businessContexts(ctx.actor,[target.id],db))[0];
    label={barcode:'HYOV1'+createHash('sha256').update(a.binding_id+':'+a.snapshot_hash).digest('hex').slice(0,20).toUpperCase(),device_id:device,task_id:target.id,binding_id:a.binding_id,snapshot_hash:a.snapshot_hash,spool_id:target.spool_id,assignment:a,order:{code:c.external_code,spool:c.spool_code,spec:target.context_snapshot.specification.code,length:Number(target.planned_length_m),externalId:target.id,taskCode:target.task_code,scanRound:target.context_snapshot.scan_execution?.round||1,sourceTaskCode:target.context_snapshot.scan_execution?.source_task_code||target.task_code}};
   }
   const result={label,ended_task_id:ended?.id??null,command_id:b.command_id};
   await db.query('INSERT INTO m02.command_receipt(factory_id,actor_id,command_key,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[ctx.actor.factory,ctx.actor.id,b.command_id,hash,JSON.stringify(result)]);
   return result;
  });
 }
}
