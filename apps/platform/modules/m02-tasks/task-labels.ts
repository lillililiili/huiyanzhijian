import {createHash} from 'node:crypto';
import {transaction} from '../../infrastructure/db';
import {requireValue,idField} from '../../infrastructure/errors';
import {allow,deviceScope,type Actor} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {TaskApi} from './api';

export function taskBarcode(id:string,revision:string){
 requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)&&/^[1-9][0-9]{0,18}$/.test(revision),'LABEL_INVALID','任务标识无效',422);
 return 'HYT1'+id.replaceAll('-','').toUpperCase()+'V'+revision;
}
export function parseTaskBarcode(code:string){
 const m=/^HYT1([0-9A-F]{32})V([1-9][0-9]{0,18})$/.exec(code);
 requireValue(m,'LABEL_INVALID','不是本平台任务条码',422);
 const h=m![1].toLowerCase();return {id:`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`,revision:m![2]};
}
export class TaskLabels {
 constructor(private tasks:TaskApi,private catalog:CatalogApi){}
 async list(actor:Actor,orderId:string){
  allow(actor,'data:read','USER');idField(orderId);
  return transaction(async db=>{
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const order=(await db.query('SELECT id,external_code FROM m02.work_order WHERE factory_id=$1 AND id=$2',[actor.factory,orderId])).rows[0];
   requireValue(order,'RESOURCE_NOT_FOUND','工单不存在或无权访问',404);
   const rows=(await db.query(`SELECT t.*,s.spool_code FROM m02.inspection_task t JOIN m02.cable_spool s ON s.id=t.spool_id WHERE t.factory_id=$1 AND t.work_order_id=$2 ORDER BY t.task_code,t.id LIMIT 1001`,[actor.factory,orderId])).rows;
   requireValue(rows.length<=1000,'LABEL_LIMIT','本工单超过1000个任务，请分批安排工单后下载',422);
   return {order,as_of:new Date().toISOString(),items:rows.map(t=>({barcode:taskBarcode(t.id,String(t.association_version)),task_id:t.id,task_code:t.task_code,work_order_id:order.id,order_code:order.external_code,spool_code:t.spool_code,process_id:t.process_id,metric_code:t.metric_code,device_id:t.device_id,state:t.state,data_environment:t.data_environment,association_version:String(t.association_version),specification:t.context_snapshot.specification}))};
  });
 }
 async resolve(actor:Actor,device:string,code:string){
  deviceScope(actor,device);const parsed=parseTaskBarcode(code),t=await this.tasks.get(actor,parsed.id);
  deviceScope(actor,t.device_id,t.data_environment);
  requireValue(t.device_id===device,'LABEL_DEVICE_MISMATCH','条码与本设备不匹配',409);
  requireValue(String(t.association_version)===parsed.revision,'LABEL_SUPERSEDED','任务归属已更正，请重新下载条码',409);
  requireValue(t.state==='RUNNING','TASK_STATE_CONFLICT','请先在平台开始此任务；结束或取消任务不能扫码采集',409);
  requireValue(t.metric_code==='OVALITY'&&t.data_environment==='SIMULATED','LABEL_ADAPTER_UNAVAILABLE','此检测项或真实设备的扫码采集适配尚未启用',409);
  const d=await this.catalog.getDevice(actor.factory,device);requireValue(d.enabled,'DEVICE_DISABLED','设备已停用',409);
  const a=(await this.tasks.assignment(actor,device)).assignment;
  requireValue(a&&a.task_id===t.id,'BINDING_SUPERSEDED','设备当前绑定已变化',409);
  const c=(await this.tasks.businessContexts(actor,[t.id]))[0];
  requireValue(c&&String(c.association_version)===parsed.revision,'LABEL_SUPERSEDED','任务归属已变化，请重新下载',409);
  requireValue(Number(t.planned_length_m)>0&&Number(t.planned_length_m)<=1e8,'LABEL_LENGTH_REQUIRED','当前边缘送料需要有效计划长度，请先补齐任务计划长度',409);
  // Same registration identity as the existing simulator. Never start a task here.
  return {barcode:'HYOV1'+createHash('sha256').update(a.binding_id+':'+a.snapshot_hash).digest('hex').slice(0,20).toUpperCase(),device_id:device,task_id:t.id,binding_id:a.binding_id,snapshot_hash:a.snapshot_hash,
   order:{code:c.external_code,spool:c.spool_code,spec:t.context_snapshot.specification.code,length:Number(t.planned_length_m),externalId:t.id}};
 }
 async resolveForCredential(actor:Actor,code:string){
  allow(actor,'device:ingest','DEVICE');const t=await this.tasks.get(actor,parseTaskBarcode(code).id);
  return this.resolve(actor,t.device_id,code);
 }
}
