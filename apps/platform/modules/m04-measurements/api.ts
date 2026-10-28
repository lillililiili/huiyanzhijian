import {randomUUID,createHmac} from 'node:crypto';
import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {pool,transaction,lock,timestamp} from '../../infrastructure/db';
import {ApiError,requireValue,object,idPattern} from '../../infrastructure/errors';
import {digest,instantMicros} from '../../infrastructure/canonical';
import {validate} from '../../infrastructure/schema';
import {IdentityApi,allow,deviceScope,type Actor,type Context} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {TaskApi} from '../m02-tasks/api';
import {RuleApi,units,unapproved} from '../m03-rules/api';
export const limits={measurements_per_batch:500,alarms_per_batch:100,json_body_bytes:1048576,evidence_bytes:8388608,heartbeat_interval_seconds:10,offline_after_seconds:30,heartbeat_max_age_seconds:15,clock_skew_seconds:5};
function uint(v:string|null){return v===null||BigInt(v)<=18446744073709551615n;}
function rawValid(v:any,depth=0):boolean {if(depth>8)return false;if(typeof v==='number')return Number.isSafeInteger(v);if(v&&typeof v==='object'){if(!Array.isArray(v)&&Object.keys(v).length>128)return false;return Object.values(v).every(x=>rawValid(x,depth+1));}return true;}

export function decode170A2DStatusWord(statusHexOrInt: unknown) {
  let word = 0x0002;
  if (typeof statusHexOrInt === 'string' && /^0x[0-9a-fA-F]+$/.test(statusHexOrInt)) {
    word = parseInt(statusHexOrInt, 16);
  } else if (typeof statusHexOrInt === 'number' && Number.isInteger(statusHexOrInt)) {
    word = statusHexOrInt & 0xffff;
  }
  const axisCount = word & 0x000f;
  const deviceFault = (word & (1 << 7)) !== 0;
  const deviceNoObject = (word & (1 << 6)) !== 0;
  const deviceError = (word & (1 << 5)) !== 0;
  const axis1Fault = (word & (1 << 11)) !== 0;
  const axis1NoObject = (word & (1 << 10)) !== 0;
  const axis1Error = (word & (1 << 9)) !== 0;
  const axis2Fault = (word & (1 << 15)) !== 0;
  const axis2NoObject = (word & (1 << 14)) !== 0;
  const axis2Error = (word & (1 << 13)) !== 0;
  const hasAnyAbnormalBit = (word & 0xeee0) !== 0;

  let displaySymbol = 'Norm';
  if (deviceFault || axis1Fault || axis2Fault) displaySymbol = 'FAUL';
  else if (axis1Error && axis2Error) displaySymbol = 'Err-3 / Err-4';
  else if (axis1Error) displaySymbol = 'Err-3 (X轴无光或多根被测物)';
  else if (axis2Error) displaySymbol = 'Err-4 (Y轴无光或多根被测物)';
  else if (axis1NoObject && axis2NoObject) displaySymbol = 'Err-6 / Err-7 (¯_¯_¯)';
  else if (axis1NoObject) displaySymbol = 'Err-6 (X轴未检测到被测物)';
  else if (axis2NoObject) displaySymbol = 'Err-7 (Y轴未检测到被测物)';
  else if (deviceNoObject) displaySymbol = '¯_¯_¯';

  return {
    status_word_hex: '0x' + (word & 0xffff).toString(16).toUpperCase().padStart(4, '0'),
    axis_count: axisCount,
    has_abnormal_bit: hasAnyAbnormalBit,
    device_state: { fault: deviceFault, no_object: deviceNoObject, error: deviceError },
    axis1_x_state: { fault: axis1Fault, no_object: axis1NoObject, error: axis1Error },
    axis2_y_state: { fault: axis2Fault, no_object: axis2NoObject, error: axis2Error },
    display_symbol: displaySymbol,
  };
}

function validateOvalityObservation(r: any) {
  const v = r?.values?.[0];
  if (!v || v.metric_code !== 'OVALITY') return;
  const obs = r?.raw?.data?.observation;
  if (!obs || typeof obs !== 'object') return;

  const statusHex = obs.registers?.['0x0200_status_word'] ?? r?.raw?.data?.status_word;
  if (r.data_status === 'VALID') {
    if (statusHex !== undefined) {
      const decoded = decode170A2DStatusWord(statusHex);
      requireValue(decoded.axis_count === 2, 'RECORD_INVALID', '170A-2D状态字(0x0200)轴数必须为2');
      requireValue(!decoded.has_abnormal_bit, 'RECORD_INVALID', '170A-2D状态字(0x0200)含故障/无被测物/错误位，不能作为VALID有效记录入库');
    }
    if (obs.diameter_x_mm !== undefined && obs.diameter_y_mm !== undefined) {
      let dx: Decimal, dy: Decimal;
      try {
        dx = new Decimal(String(obs.diameter_x_mm));
        dy = new Decimal(String(obs.diameter_y_mm));
      } catch {
        throw new ApiError(400, 'RECORD_INVALID', '170A-2D双向测径仪X/Y轴直径必须为有效十进制数值');
      }
      requireValue(dx.gt(0) && dy.gt(0), 'RECORD_INVALID', 'VALID有效状态下170A-2D双轴直径(Dx, Dy)必须大于0');

      const avg = dx.plus(dy).div(2);
      const diff = dx.minus(dy).abs();
      const expectedOvalityPct = diff.div(avg).times(100);

      if (v.value !== null && v.value !== undefined) {
        const reportedVal = new Decimal(String(v.value));
        requireValue(
          reportedVal.minus(expectedOvalityPct).abs().lte(new Decimal('0.05')),
          'RECORD_INVALID',
          '不圆度百分比与椭圆长短轴(a,b)推导值不一致'
        );
      }
    }
  }
}

export function extractOvalityTelemetry(rawPayload: any) {
  const obs = rawPayload?.raw?.data?.observation;
  if (!obs || typeof obs !== 'object' || obs.diameter_x_mm === undefined || obs.diameter_y_mm === undefined) {
    return null;
  }
  const statusHex = obs.registers?.['0x0200_status_word'] ?? rawPayload?.raw?.data?.status_word ?? '0x0002';
  const statusDecoded = decode170A2DStatusWord(statusHex);
  const dx = Number(obs.diameter_x_mm);
  const dy = Number(obs.diameter_y_mm);
  const major = obs.major_axis_mm !== undefined ? String(obs.major_axis_mm) : Math.max(dx, dy).toFixed(6);
  const minor = obs.minor_axis_mm !== undefined ? String(obs.minor_axis_mm) : Math.min(dx, dy).toFixed(6);
  const avg = obs.average_diameter_mm !== undefined ? String(obs.average_diameter_mm) : ((dx + dy) / 2).toFixed(6);
  const diff = obs.ovality_difference_mm !== undefined ? String(obs.ovality_difference_mm) : Math.abs(dx - dy).toFixed(6);
  const centripetalF =
    obs.centripetal_ratio_f !== undefined
      ? String(obs.centripetal_ratio_f)
      : Math.max(dx, dy) > 0
        ? (Math.min(dx, dy) / Math.max(dx, dy)).toFixed(6)
        : '0';
  const axisRatio =
    obs.axis_ratio_f !== undefined
      ? String(obs.axis_ratio_f)
      : Math.min(dx, dy) > 0
        ? (Math.max(dx, dy) / Math.min(dx, dy)).toFixed(6)
        : '0';

  return {
    instrument_model: obs.instrument_model || rawPayload?.raw?.data?.instrument_model || 'Opmac-170AL2-2D',
    protocol: obs.protocol || rawPayload?.raw?.data?.protocol || 'MODBUS_RTU',
    comm_settings: obs.comm_settings || 'ADD1=1, BAUD1=9600, CH-T1=2 (Modbus-RTU 8N1)',
    status_decoded: statusDecoded,
    diameter_x_mm: String(obs.diameter_x_mm),
    diameter_y_mm: String(obs.diameter_y_mm),
    axis1_position_pct: obs.axis1_position_pct ?? obs.registers?.['0x0203_axis1_position'] ?? 0,
    axis2_position_pct: obs.axis2_position_pct ?? obs.registers?.['0x0205_axis2_position'] ?? 0,
    major_axis_mm: major,
    minor_axis_mm: minor,
    average_diameter_mm: avg,
    reference_diameter_mm: obs.reference_diameter_mm ?? null,
    deviation_avg_mm: obs.deviation_avg_mm ?? null,
    deviation_x_mm: obs.deviation_x_mm ?? null,
    deviation_y_mm: obs.deviation_y_mm ?? null,
    ovality_difference_mm: diff,
    centripetal_ratio_f: centripetalF,
    axis_ratio_f: axisRatio,
    registers: obs.registers || null,
  };
}
export class MeasurementApi{
 constructor(private identity:IdentityApi,private catalog:CatalogApi,private tasks:TaskApi,private rules:RuleApi){}
 async profile(actor:Actor){const devices=[];for(const id of actor.devices){const d=await this.catalog.getDevice(actor.factory,id);devices.push({device_id:id,metric_codes:[d.metric_code],raw_schema_versions:d.raw_schema_versions,source_identification:d.source_identification,position_supported:true,image_supported:false,source_alarm_supported:false,offline_replay_supported:true});}return {schema_versions:['1.0'],server_time:new Date().toISOString(),factory_id:actor.factory,data_environment:actor.environment,devices,limits,rate_limit_policy_id:'b1-device-120-per-minute',retention_policy_id:'b1-no-auto-purge'};}
 async session(ctx:Context,b:any){validate('SessionRequest',b);deviceScope(ctx.actor,b.device_id,b.data_environment);const device=await this.catalog.getDevice(ctx.actor.factory,b.device_id);requireValue(device.enabled,'ACCESS_DENIED','设备已停用',403);return transaction(async db=>{
  await lock(db,'connection:'+b.device_id);const old=await db.query('SELECT * FROM m04.device_connection WHERE device_id=$1 AND client_session_id=$2',[b.device_id,b.client_session_id]);let connection:string;
  if(old.rowCount){requireValue(!old.rows[0].superseded_at,'SESSION_SUPERSEDED','旧连接已被替代',409);requireValue(old.rows[0].payload_hash===digest(b),'RECORD_PAYLOAD_CONFLICT','会话内容发生变化',409);connection=old.rows[0].id;}
  else{connection=randomUUID();await db.query('UPDATE m04.device_connection SET superseded_at=now(),online_until=NULL WHERE device_id=$1 AND superseded_at IS NULL',[b.device_id]);await db.query('INSERT INTO m04.device_connection(id,factory_id,device_id,client_session_id,payload_hash) VALUES($1,$2,$3,$4,$5)',[connection,ctx.actor.factory,b.device_id,b.client_session_id,digest(b)]);await this.identity.audit(ctx,'DEVICE_SESSION_OPEN','DEVICE',b.device_id,{},db);}
  return {connection_id:connection,device_id:b.device_id,client_session_id:b.client_session_id,active:true,server_time:new Date().toISOString()};
 });}
 async checkConnection(actor:Actor,device:string,id:string){deviceScope(actor,device);const r=await pool.query('SELECT 1 FROM m04.device_connection WHERE id=$1 AND device_id=$2 AND factory_id=$3 AND superseded_at IS NULL',[id,device,actor.factory]);requireValue(r.rowCount,'SESSION_SUPERSEDED','连接已被替代或不存在',409);}
 async heartbeat(ctx:Context,b:any){validate('Heartbeat',b);deviceScope(ctx.actor,b.device_id,b.data_environment);requireValue(uint(b.heartbeat_sequence),'REQUEST_INVALID','序号超出uint64');const d=await this.catalog.getDevice(ctx.actor.factory,b.device_id);requireValue(d.enabled,'ACCESS_DENIED','设备已停用',403);return transaction(async db=>{
  const r=await db.query('SELECT * FROM m04.device_connection WHERE id=$1 AND device_id=$2 AND factory_id=$3 AND superseded_at IS NULL FOR UPDATE',[b.connection_id,b.device_id,ctx.actor.factory]);requireValue(r.rowCount,'SESSION_SUPERSEDED','连接已被替代',409);const now=Date.now(),age=now-Date.parse(b.sent_at),last=r.rows[0].last_heartbeat_sequence;
  const reason=age>15000?'HEARTBEAT_EXPIRED':age< -5000?'CLOCK_SKEW':last!==null&&BigInt(b.heartbeat_sequence)<=BigInt(last)?'HEARTBEAT_OUT_OF_ORDER':null;
  const until=reason?null:new Date(now+30000).toISOString();if(!reason)await db.query('UPDATE m04.device_connection SET last_heartbeat_sequence=$2,last_heartbeat_at=now(),online_until=$3,heartbeat_payload=$4 WHERE id=$1',[b.connection_id,b.heartbeat_sequence,until,JSON.stringify(b)]);return {accepted:!reason,reason_code:reason,server_time:new Date(now).toISOString(),online_until:until};
 });}
 private reject(index:number,source:string|null,code:string,fields:unknown[]=[]){return {input_index:index,source_id:source,receipt_status:'REJECTED',stored_id:null,initial_status:null,first_received_at:null,error_code:code,retryable:false,retry_after_ms:null,field_errors:fields};}
 private receipt(row:any,index:number,duplicate=false){return {input_index:index,source_id:row.source_record_key,receipt_status:duplicate?'DUPLICATE':row.receipt_status,stored_id:row.id,initial_status:row.receipt_status,first_received_at:row.received,error_code:row.isolation_reason,retryable:false,retry_after_ms:null,field_errors:[]};}
 async ingest(ctx:Context,b:any){
  object(b,['schema_version','batch_id','sent_at','records']);requireValue(b.schema_version==='1.0','SCHEMA_VERSION_UNSUPPORTED','本阶段仅支持设备契约1.0');validate('Id',b.batch_id);validate('Timestamp',b.sent_at);requireValue(Array.isArray(b.records)&&b.records.length>0);requireValue(b.records.length<=500,'BATCH_LIMIT_EXCEEDED','批次超过500条',413);
  // Complete scope preflight precedes all business writes, including valid items.
  for(const record of b.records)if(record&&typeof record==='object'){if(typeof record.device_id==='string')deviceScope(ctx.actor,record.device_id);if(record.data_environment!==undefined&&record.data_environment!==ctx.actor.environment)throw new ApiError(403,'SOURCE_NOT_ALLOWED','来源环境超出凭据范围');}
  const batch=randomUUID();await pool.query("INSERT INTO m04.ingestion_batch(id,request_id,source_batch_id,factory_id,credential_id,total,state) VALUES($1,$2,$3,$4,$5,$6,'PROCESSING')",[batch,ctx.requestId,b.batch_id,ctx.actor.factory,ctx.actor.id,b.records.length]);
  const items=[];
  for(let index=0;index<b.records.length;index++){
   const r=b.records[index];let item:any;let hash:string|null=null;
   try{
    validate('Measurement',r);requireValue(uint(r.capture_sequence)&&uint(r.binding_version),'RECORD_INVALID','序号超出uint64');hash=digest(r);
    const d=await this.catalog.getDevice(ctx.actor.factory,r.device_id);requireValue(d.enabled,'ACCESS_DENIED','设备停用；未授权历史补传',403);
    requireValue(d.data_environment===r.data_environment,'SOURCE_NOT_ALLOWED','设备环境不匹配',403);
    requireValue(r.data_status===r.values[0].data_status&&r.values[0].metric_code===d.metric_code,'RECORD_INVALID','指标或有效性不一致');requireValue(units[r.values[0].metric_code]===r.values[0].unit,'UNIT_MISMATCH','单位不匹配');
    requireValue(d.raw_schema_versions.includes(r.raw.schema_version),'RAW_SCHEMA_UNSUPPORTED','原文版本未注册');requireValue(Buffer.byteLength(JSON.stringify(r.raw))<=65536&&rawValid(r.raw.data),'RAW_LIMIT_EXCEEDED','原文结构/大小/数值超出限制');validateOvalityObservation(r);
    requireValue(!(r.data_environment==='REAL'&&r.time_source==='SIMULATOR'),'SOURCE_NOT_ALLOWED','真实数据不能使用模拟时间来源');requireValue(r.sample_kind!=='NEW_SAMPLE'||d.source_identification==='SAMPLE_ID','RECORD_INVALID','缺少可靠新样本标识');
    const w=r.values[0].window;if(w.kind==='POSITION')requireValue(new Decimal(w.position_to_m).gte(w.position_from_m),'WINDOW_INVALID','位置窗口倒序');if(w.kind==='TIME')requireValue(instantMicros(w.end)>=instantMicros(w.start),'WINDOW_INVALID','时间窗口倒序');
    requireValue(r.evidence_refs.length===0,'EVIDENCE_NOT_READY','本阶段未开通证据上传');
    const assignment=await this.tasks.verifyRecord(ctx.actor.factory,r);
    let reason=assignment?null:'TASK_BINDING_UNVERIFIED';if(Date.parse(r.sample_time)>Date.now()+5000)reason='SAMPLE_TIME_UNVERIFIED';
    const rule=assignment?.rule_snapshot||unapproved;const evaluation=reason?{quality_result:'NOT_EVALUATED',reason_code:reason}:this.rules.evaluate(r.values[0],rule,r.data_environment);
    item=await transaction(async db=>{
     await lock(db,`measurement:${ctx.actor.factory}:${r.device_id}`);
     const old=await db.query(`SELECT *,${timestamp('received_at')} AS received FROM m04.measurement_record WHERE factory_id=$1 AND device_id=$2 AND source_record_key=$3`,[ctx.actor.factory,r.device_id,r.record_id]);
     if(old.rowCount){if(old.rows[0].payload_hash===hash)return this.receipt(old.rows[0],index,true);await db.query('INSERT INTO m04.ingestion_conflict(id,factory_id,device_id,source_id,original_record_id,conflicting_hash,request_id,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),ctx.actor.factory,r.device_id,r.record_id,old.rows[0].id,hash,ctx.requestId,'RECORD_PAYLOAD_CONFLICT']);return this.reject(index,r.record_id,'RECORD_PAYLOAD_CONFLICT');}
     const seq=await db.query('SELECT id FROM m04.measurement_record WHERE factory_id=$1 AND device_id=$2 AND capture_session_id=$3 AND capture_sequence=$4',[ctx.actor.factory,r.device_id,r.capture_session_id,r.capture_sequence]);if(seq.rowCount)return this.reject(index,r.record_id,'CAPTURE_SEQUENCE_CONFLICT');
     const id=randomUUID();const fields=['id','factory_id','device_id','source_record_key','capture_session_id','capture_sequence','source_record_id','source_session_id','source_sequence','task_id','binding_id','binding_version','recipe_version_id','sample_kind','sample_time','time_source','position_m','position_quality','position_segment_id','source_type','data_environment','data_status','receipt_status','isolation_reason','raw_payload','payload_hash','schema_version'];
     const values=[id,ctx.actor.factory,r.device_id,r.record_id,r.capture_session_id,r.capture_sequence,r.source_record_id,r.source_session_id,r.source_sequence,assignment?r.task_id:null,r.binding_id,r.binding_version,r.recipe_version_id,r.sample_kind,r.sample_time,r.time_source,r.position_m,r.position_quality,r.position_segment_id,r.source_type,r.data_environment,r.data_status,reason?'QUARANTINED':'STORED',reason,JSON.stringify(r),hash,'1.0'];
     const stored=await db.query(`INSERT INTO m04.measurement_record(${fields.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *,${timestamp('received_at')} AS received`,values);const v=r.values[0];
     await db.query('INSERT INTO m04.measurement_value(record_id,metric_code,value,unit,data_status,source_quality_result,method_id,window_definition,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,v.metric_code,v.value,v.unit,v.data_status,v.source_quality_result,v.method_id,JSON.stringify(v.window),v.reason_code]);
     await db.query('INSERT INTO m04.measurement_evaluation(record_id,version,quality_result,reason_code,recipe_version_id,rule_snapshot) VALUES($1,1,$2,$3,$4,$5)',[id,evaluation.quality_result,evaluation.reason_code,r.recipe_version_id,JSON.stringify(rule)]);
     await db.query('INSERT INTO m04.measurement_qualification(record_id,version,eligibility,reason_code) VALUES($1,1,$2,$3)',[id,reason?'QUARANTINED':'EFFECTIVE',reason]);
     await db.query("INSERT INTO m04.measurement_outbox(event_id,event_type,schema_version,factory_id,data_environment,aggregate_id,aggregate_version,payload) VALUES($1,'MeasurementStored.v1','1.0',$2,$3,$4,1,$5)",[randomUUID(),ctx.actor.factory,r.data_environment,id,JSON.stringify({record_id:id,task_id:assignment?r.task_id:null,eligibility:reason?'QUARANTINED':'EFFECTIVE',quality_result:evaluation.quality_result,evaluation_version:1})]);return this.receipt(stored.rows[0],index);
    });
   }catch(e){if(e instanceof ApiError)item=this.reject(index,typeof r?.record_id==='string'&&idPattern.test(r.record_id)?r.record_id:null,e.code,e.fields);else throw new ApiError(503,'DEPENDENCY_UNAVAILABLE','接收结果可能部分提交，请保留来源键后对账',[],'UNKNOWN');}
   await pool.query('INSERT INTO m04.ingestion_item(batch_id,input_index,source_id,stored_id,receipt_status,error_code,field_errors,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[batch,index,item.source_id,item.stored_id,item.receipt_status,item.error_code,JSON.stringify(item.field_errors),hash]);items.push(item);
  }
  const counts={total:items.length,stored:0,duplicate:0,quarantined:0,rejected:0};for(const item of items)counts[item.receipt_status.toLowerCase() as 'stored']++;
  await pool.query("UPDATE m04.ingestion_batch SET completed_at=now(),state='COMPLETED',stored=$2,duplicate=$3,quarantined=$4,rejected=$5 WHERE id=$1",[batch,counts.stored,counts.duplicate,counts.quarantined,counts.rejected]);return {schema_version:'1.0',batch_id:b.batch_id,counts,items};
 }
 async receipts(actor:Actor,b:any){validate('ReceiptQuery',b);deviceScope(actor,b.device_id);requireValue(b.kind==='MEASUREMENT','FEATURE_NOT_IMPLEMENTED','本阶段未开通源报警查询',501);const rows=await pool.query(`SELECT source_record_key,id,receipt_status,${timestamp('received_at')} AS received FROM m04.measurement_record WHERE factory_id=$1 AND device_id=$2 AND source_record_key=ANY($3)`,[actor.factory,b.device_id,b.source_ids]);return {device_id:b.device_id,kind:b.kind,as_of:new Date().toISOString(),items:b.source_ids.map((id:string)=>{const r=rows.rows.find(x=>x.source_record_key===id);return {source_id:id,lookup_status:r?'FOUND':'NOT_FOUND',stored_id:r?.id||null,initial_status:r?.receipt_status||null,first_received_at:r?.received||null};})};}
 async status(actor:Actor,db:Pick<PoolClient,'query'>=pool){return (await db.query(`SELECT device_id,id AS connection_id,online_until>now() AS online,${timestamp('last_heartbeat_at')} AS last_heartbeat_at,${timestamp('online_until')} AS online_until,heartbeat_payload FROM m04.device_connection WHERE factory_id=$1 AND superseded_at IS NULL ORDER BY device_id`,[actor.factory])).rows;}
 async query(actor:Actor,params:Record<string,string>){
  return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return this.querySnapshot(actor,params,db);});
 }
 private async querySnapshot(actor:Actor,params:Record<string,string>,db:PoolClient){
  const scope=params.spool_id?await this.tasks.spoolScope(actor,params.spool_id,db):null;
  const processIds=params.process_id?await this.tasks.taskIdsForProcess(actor,params.process_id,db):null;
  const ids=params.task_ids?params.task_ids.split(','):null;
    requireValue(!ids||(ids.length<=200&&ids.every(id=>idPattern.test(id))));
    for(const key of ['from','to'])if(params[key])requireValue(/^\d{4}-\d{2}-\d{2}T/.test(params[key])&&Number.isFinite(Date.parse(params[key])),'REQUEST_INVALID','时间必须为ISO格式');
    requireValue(!params.from||!params.to||Date.parse(params.from)<Date.parse(params.to),'REQUEST_INVALID','结束时间必须晚于开始时间');
    requireValue(!params.order||['asc','desc'].includes(params.order));
    requireValue(!params.quality||['PASS','FAIL','NOT_EVALUATED'].includes(params.quality));
    requireValue(!params.environment||['SIMULATED','REAL'].includes(params.environment));
    requireValue(!params.data_status||['VALID','INVALID','MISSING'].includes(params.data_status));
    requireValue(!params.receipt_status||['STORED','QUARANTINED'].includes(params.receipt_status));
    let selectedTasks=scope?scope.tasks.map(t=>t.id).filter(id=>!ids||ids.includes(id)):ids;
    if(processIds)selectedTasks=selectedTasks?selectedTasks.filter(id=>processIds.includes(id)):processIds;
    const filter={association_revision:await this.tasks.associationRevision(actor,db),process:params.process_id||null,spool:params.spool_id||null,scope_hash:scope?.scope_hash||null,validity:params.data_status||null,receipt:params.receipt_status||null,factory:actor.factory,device:params.device_id||null,task:params.task_id||null,metric:params.metric_code||null,tasks:selectedTasks,from:params.from||null,to:params.to||null,quality:params.quality||null,environment:params.environment||null,order:params.order||'asc'};const filterHash=digest(filter),limit=Number(params.limit||50);requireValue(Number.isInteger(limit)&&limit>=1&&limit<=100);
  const secret=process.env.CURSOR_SECRET;requireValue(secret,'DEPENDENCY_UNAVAILABLE','缺少游标签名配置',503);const sign=(s:string)=>createHmac('sha256',secret).update(s).digest('base64url');
  let upper:string,after='0',asOf:string;
  if(params.cursor){try{const [s,h]=params.cursor.split('.');requireValue(h===sign(s));const c=JSON.parse(Buffer.from(s,'base64url').toString());requireValue(c.filter===filterHash&&/^\d+$/.test(c.upper)&&/^\d+$/.test(c.after));upper=c.upper;after=c.after;asOf=c.as_of;}catch{throw new ApiError(400,'REQUEST_INVALID','游标无效或查询范围已变化（含盘号、归并及任务集合）；请刷新查询');}}
  else{const r=await db.query('SELECT COALESCE(MAX(ingest_order),0)::text AS upper FROM m04.measurement_record WHERE factory_id=$1',[actor.factory]);upper=r.rows[0].upper;asOf=new Date().toISOString();if(filter.order==='desc')after=(BigInt(upper)+1n).toString();}
  const total=Number((await db.query(`SELECT count(*)::int AS total FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1 JOIN m04.measurement_qualification q ON q.record_id=r.id AND q.version=1 WHERE r.factory_id=$1 AND ($2::text IS NULL OR r.device_id=$2) AND ($3::text IS NULL OR r.task_id=$3) AND ($4::text IS NULL OR v.metric_code=$4) AND r.ingest_order<=$5 AND ($6::text[] IS NULL OR r.task_id=ANY($6)) AND ($7::timestamptz IS NULL OR r.sample_time >= $7) AND ($8::timestamptz IS NULL OR r.sample_time < $8) AND ($9::text IS NULL OR e.quality_result=$9) AND ($10::text IS NULL OR r.data_environment=$10) AND ($11::text IS NULL OR r.data_status=$11) AND ($12::text IS NULL OR r.receipt_status=$12)`,[actor.factory,filter.device,filter.task,filter.metric,upper,filter.tasks,filter.from,filter.to,filter.quality,filter.environment,filter.validity,filter.receipt])).rows[0].total);
  const rows=(await db.query(`SELECT r.id,r.task_id,r.ingest_order::text,r.raw_payload,r.receipt_status,r.position_eligibility,to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at,v.value,v.metric_code,v.unit,e.quality_result,e.reason_code AS evaluation_reason,q.eligibility FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1 JOIN m04.measurement_qualification q ON q.record_id=r.id AND q.version=1 WHERE r.factory_id=$1 AND ($2::text IS NULL OR r.device_id=$2) AND ($3::text IS NULL OR r.task_id=$3) AND ($4::text IS NULL OR v.metric_code=$4) AND r.ingest_order${filter.order==='desc'?'<':'>'}$5 AND r.ingest_order<=$6 AND ($8::text[] IS NULL OR r.task_id=ANY($8)) AND ($9::timestamptz IS NULL OR r.sample_time >= $9) AND ($10::timestamptz IS NULL OR r.sample_time < $10) AND ($11::text IS NULL OR e.quality_result=$11) AND ($12::text IS NULL OR r.data_environment=$12) AND ($13::text IS NULL OR r.data_status=$13) AND ($14::text IS NULL OR r.receipt_status=$14) ORDER BY r.ingest_order ${filter.order==='desc'?'DESC':'ASC'} LIMIT $7`,[actor.factory,filter.device,filter.task,filter.metric,after,upper,limit+1,filter.tasks,filter.from,filter.to,filter.quality,filter.environment,filter.validity,filter.receipt])).rows;
  const more=rows.length>limit,items=rows.slice(0,limit);
  const contexts=await this.tasks.businessContexts(actor,[...new Set(items.map(r=>r.task_id).filter(Boolean))],db);
  for(const item of items){item.business_context=contexts.find(c=>c.task_id===item.task_id)||null;if(item.metric_code==='OVALITY')item.ovality_telemetry=extractOvalityTelemetry(item.raw_payload);}
  let cursor=null;if(more){const s=Buffer.from(JSON.stringify({filter:filterHash,upper,after:items.at(-1).ingest_order,as_of:asOf})).toString('base64url');cursor=s+'.'+sign(s);}return {items,total,has_more:more,next_cursor:cursor,as_of:asOf,scope:scope?{root_id:scope.root_id,members:scope.members,task_count:scope.tasks.length,scope_hash:scope.scope_hash}:null};
 }
 async simulationSampledTasks(actor:Actor,db:Pick<PoolClient,'query'>=pool){
  allow(actor,'device:ingest','DEVICE');requireValue(actor.environment==='SIMULATED','SOURCE_NOT_ALLOWED','仅模拟来源',403);
  return (await db.query("SELECT DISTINCT task_id FROM m04.measurement_record WHERE factory_id=$1 AND device_id=ANY($2::text[]) AND data_environment='SIMULATED' AND receipt_status='STORED' AND task_id IS NOT NULL",[actor.factory,actor.devices])).rows.map(r=>r.task_id as string);
 }
 async taskSummaries(actor:Actor,ids:string[],db:Pick<PoolClient,'query'>=pool){
  return (await db.query(`SELECT r.task_id,count(*)::int AS total,
   count(*) FILTER(WHERE v.data_status='VALID')::int AS valid,
   count(*) FILTER(WHERE v.data_status<>'VALID')::int AS invalid,
   count(*) FILTER(WHERE e.quality_result='PASS')::int AS passed,
   count(*) FILTER(WHERE e.quality_result='FAIL')::int AS failed,
   count(*) FILTER(WHERE e.quality_result='NOT_EVALUATED')::int AS unevaluated,
   count(*) FILTER(WHERE r.receipt_status='QUARANTINED')::int AS quarantined,
   to_char(min(r.sample_time) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_sample_at,
   to_char(max(r.sample_time) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS latest_sample_at,
   min(v.value) FILTER(WHERE v.data_status='VALID' AND r.receipt_status='STORED')::text AS minimum,
   max(v.value) FILTER(WHERE v.data_status='VALID' AND r.receipt_status='STORED')::text AS maximum,
   avg(v.value) FILTER(WHERE v.data_status='VALID' AND r.receipt_status='STORED')::text AS mean,
   min(v.unit) AS unit
   FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
   JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1
   WHERE r.factory_id=$1 AND r.task_id=ANY($2::text[]) GROUP BY r.task_id`,[actor.factory,ids])).rows;
 }
 async taskActivity(actor:Actor,ids:string[],db:Pick<PoolClient,'query'>=pool){
  return (await db.query(`SELECT DISTINCT ON (r.task_id) r.task_id,r.id AS record_id,r.ingest_order::text,
   to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_at,
   to_char(r.sample_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sample_time,
   v.value::text,v.unit,v.data_status,r.receipt_status,e.quality_result
   FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
   JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1
   WHERE r.factory_id=$1 AND r.task_id=ANY($2::text[]) ORDER BY r.task_id,r.ingest_order DESC`,[actor.factory,ids])).rows;
 }
 async taskSummary(actor:Actor,id:string){
  const r=await pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE v.data_status='VALID')::int AS valid,count(*) FILTER(WHERE v.data_status<>'VALID')::int AS invalid,count(*) FILTER(WHERE e.quality_result='FAIL')::int AS failed,count(*) FILTER(WHERE e.quality_result='NOT_EVALUATED')::int AS unevaluated,count(*) FILTER(WHERE r.receipt_status='QUARANTINED')::int AS quarantined,min(r.sample_time) AS first_sample_at,max(r.sample_time) AS latest_sample_at,min(v.value)::text AS minimum,max(v.value)::text AS maximum FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1 WHERE r.factory_id=$1 AND r.task_id=$2`,[actor.factory,id]);return r.rows[0];
 }
 async detail(actor:Actor,id:string){const r=await pool.query(`SELECT *,${timestamp('received_at')} AS received_at,${timestamp('sample_time')} AS sample_time FROM m04.measurement_record WHERE factory_id=$1 AND id=$2`,[actor.factory,id]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','记录不存在');const [v,e,q]=await Promise.all([pool.query('SELECT * FROM m04.measurement_value WHERE record_id=$1',[id]),pool.query('SELECT * FROM m04.measurement_evaluation WHERE record_id=$1 ORDER BY version',[id]),pool.query('SELECT * FROM m04.measurement_qualification WHERE record_id=$1 ORDER BY version',[id])]);const ovality_telemetry=v.rows[0]?.metric_code==='OVALITY'?extractOvalityTelemetry(r.rows[0].raw_payload):undefined;return {...r.rows[0],values:v.rows,evaluations:e.rows,qualifications:q.rows,...(ovality_telemetry?{ovality_telemetry}:{})};}
 async batches(actor:Actor,limit:number,after:string){return (await pool.query('SELECT * FROM m04.ingestion_batch WHERE factory_id=$1 AND ($2=\'\' OR id::text>$2) ORDER BY id LIMIT $3',[actor.factory,after,limit])).rows;}
 async batch(actor:Actor,id:string){const r=await pool.query('SELECT * FROM m04.ingestion_batch WHERE factory_id=$1 AND id::text=$2',[actor.factory,id]);if(!r.rowCount)throw new ApiError(404,'RESOURCE_NOT_FOUND','批次不存在');return {...r.rows[0],items:(await pool.query('SELECT * FROM m04.ingestion_item WHERE batch_id=$1 ORDER BY input_index',[r.rows[0].id])).rows};}
}
