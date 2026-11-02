'use strict';
// M08: vendor wire format stays at this boundary. No database or quality-rule access.
const {createHash}=require('node:crypto');
const OVERLAP='SHIELD_OVERLAP_RATE', GAP='WIRE_GAP';
const paths={ [OVERLAP]:'/sys/copperStrip/getRealTimeData', [GAP]:'/sys/copperStrip/getGapRealTimeData' };
const schemas={ [OVERLAP]:'inspur-overlap-http.v1', [GAP]:'inspur-gap-http.v1' };
function insist(ok,code){if(!ok)throw new Error(code);}
function decimal(value,shift=0){
  insist(typeof value==='number'&&Number.isFinite(value),'VENDOR_NUMBER_INVALID');
  // Convert decimal lexical representation by shifting digits, never floating multiplication.
  const m=String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  insist(m,'VENDOR_NUMBER_INVALID');let digits=m[2]+(m[3]||''),point=m[2].length+Number(m[4]||0)+shift;
  let result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
  result=result.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
  if(m[1]&&result!=='0')result='-'+result;
  insist(/^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,10})?$/.test(result),'VENDOR_NUMBER_PRECISION_UNSUPPORTED');return result;
}
function dateText(ms,offsetMinutes){return new Date(ms+offsetMinutes*60000).toISOString().slice(0,19).replace('T',' ');}
function dateMillis(value,offsetMinutes){
  insist(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value),'VENDOR_DATE_INVALID');
  const ms=Date.parse(value.replace(' ','T')+'Z')-offsetMinutes*60000;
  insist(Number.isFinite(ms)&&dateText(ms,offsetMinutes)===value,'VENDOR_DATE_INVALID');return ms;
}
function validateQuery(q,metric,offsetMinutes=480){
  insist(q&&Object.getPrototypeOf(q)===Object.prototype,'VENDOR_QUERY_INVALID');
  insist([OVERLAP,GAP].includes(metric),'VENDOR_METRIC_UNSUPPORTED');
  const keys=['lineId','startTime','endTime','limit','page',...(metric===GAP?['dataType']:[])];
  insist(Object.keys(q).length===keys.length&&keys.every(k=>Object.hasOwn(q,k)),'VENDOR_QUERY_FIELDS');
  insist(typeof q.lineId==='string'&&q.lineId.length>0&&q.lineId.length<=128,'VENDOR_LINE_REQUIRED');
  insist(Number.isInteger(q.limit)&&q.limit>=1&&q.limit<=500&&Number.isSafeInteger(q.page)&&q.page>=1,'VENDOR_PAGE_INVALID');
  insist(dateMillis(q.startTime,offsetMinutes)<=dateMillis(q.endTime,offsetMinutes),'VENDOR_TIME_RANGE_INVALID');
  if(metric===GAP)insist(['GAP','PITCH'].includes(q.dataType),'VENDOR_DATA_TYPE_INVALID');
  return q;
}
function validateConfig(c){
  insist(c&&[OVERLAP,GAP].includes(c.metric),'VENDOR_METRIC_UNSUPPORTED');
  insist(['SIMULATED','REAL'].includes(c.environment),'VENDOR_ENVIRONMENT_REQUIRED');
  insist(['POST','GET'].includes(c.method)&&typeof c.path==='string'&&/^\/(?!\/)/.test(c.path),'VENDOR_TRANSPORT_UNCONFIRMED');
  insist(Number.isInteger(c.timezoneOffsetMinutes)&&Math.abs(c.timezoneOffsetMinutes)<=840,'VENDOR_TIMEZONE_UNCONFIRMED');
  insist(['PERCENT','FRACTION','UNKNOWN'].includes(c.percentScale)&&['mm','cm','m','UNKNOWN'].includes(c.gapUnit),'VENDOR_UNITS_CONFIG_REQUIRED');
  insist(c.sampleTimeField==='dataCreateTime'||c.sampleTimeField==='dataDate+dataTime','VENDOR_TIME_FIELD_UNCONFIRMED');
  if(c.environment==='REAL')insist(c.confirmed===true&&typeof c.confirmationReference==='string'&&c.confirmationReference.trim().length>0,'VENDOR_REAL_CONFIG_UNCONFIRMED');
  return c;
}
function stableId(device,id){return 'odm-'+createHash('sha256').update(JSON.stringify([device,id])).digest('hex');}
function mapRecord(row,context,c){
  validateConfig(c);
  insist(row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=128,'VENDOR_ID_INVALID');
  insist(row.lineId===context.lineId&&context.metric===c.metric,'VENDOR_CONTEXT_MISMATCH');
  if(c.metric===GAP)insist(row.dataType==='GAP','VENDOR_PITCH_NOT_WIRE_GAP');
  insist(typeof context.device_id==='string'&&typeof context.capture_session_id==='string'&&/^\d+$/.test(context.capture_sequence),'VENDOR_CAPTURE_CONTEXT_REQUIRED');
  // Do not guess which of the vendor's different clocks represents capture time.
  let time;
  if(c.sampleTimeField==='dataCreateTime'){
    insist(typeof row.dataCreateTime==='string'&&/^\d{1,15}$/.test(row.dataCreateTime),'VENDOR_TIMESTAMP_INVALID');
    const ms=Number(row.dataCreateTime);insist(Number.isSafeInteger(ms)&&ms<=8640000000000000,'VENDOR_TIMESTAMP_INVALID');time=new Date(ms).toISOString();
  }else time=new Date(dateMillis(row.dataDate+' '+row.dataTime,c.timezoneOffsetMinutes)).toISOString();
  let value=null,reason=null,status='VALID';
  const scalar=c.metric===OVERLAP?row.buildPercent:row.buildWidth;
  if(scalar===null){status='MISSING';reason='VENDOR_VALUE_MISSING';}
  else if(typeof scalar!=='number'||!Number.isFinite(scalar)){status='INVALID';reason='VENDOR_VALUE_INVALID';}
  else if(c.metric===OVERLAP&&c.percentScale==='UNKNOWN'||c.metric===GAP&&c.gapUnit==='UNKNOWN'){status='INVALID';reason='VENDOR_UNIT_UNCONFIRMED';}
  else {try{value=decimal(scalar,c.metric===OVERLAP?(c.percentScale==='FRACTION'?2:0):c.gapUnit==='cm'?1:c.gapUnit==='m'?3:0);}catch{status='INVALID';reason='VENDOR_NUMBER_PRECISION_UNSUPPORTED';}}
  let position=null;try{if(typeof row.seat==='number'&&row.seat>=0)position=decimal(row.seat);}catch{}
  const issues=[];
  for(const k of ['workTableTeam','customerNames','dataDate','dataTime','createTime','buildPicPath'])if(typeof row[k]!=='string')issues.push(k);
  for(const k of ['seat','buildWidth','coreSpeed',...(c.metric===OVERLAP?['angle','coreDiameter','controlStatus']:[])])if(typeof row[k]!=='number'||!Number.isFinite(row[k]))issues.push(k);
  if(issues.length){status='INVALID';value=null;reason='VENDOR_REQUIRED_FIELDS_INVALID';}
  // Supplier dates are retained verbatim even when clocks disagree. No synthetic image evidence.
  const raw={schema_version:schemas[c.metric],data:{vendor_record_json:JSON.stringify(row),mapping_version:'ODM01.v1',percent_scale:c.percentScale,gap_unit:c.gapUnit,sample_time_field:c.sampleTimeField,timezone_offset_minutes:c.timezoneOffsetMinutes,source_path:c.path,transport_method:c.method,test_only:c.environment==='SIMULATED',field_issues:issues}};
  return {record_id:context.record_id||stableId(context.device_id,row.id),device_id:context.device_id,capture_session_id:context.capture_session_id,capture_sequence:context.capture_sequence,source_record_id:/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.id)?row.id:stableId(context.device_id,row.id),source_session_id:null,source_sequence:null,sample_kind:'NEW_SAMPLE',task_id:context.task_id??null,binding_id:context.binding_id??null,binding_version:context.binding_version??null,sample_time:time,time_source:c.environment==='SIMULATED'?'SIMULATOR':'DEVICE',position_m:position,position_quality:position===null?'UNKNOWN':'KNOWN',position_segment_id:position===null?null:context.position_segment_id??context.capture_session_id,source_type:'DEVICE',data_environment:c.environment,data_status:status,recipe_version_id:context.recipe_version_id??null,values:[{metric_code:c.metric,value,unit:c.metric===OVERLAP?'%':'mm',data_status:status,source_quality_result:'NOT_EVALUATED',method_id:context.method_id??null,window:context.window||{kind:'INSTANT',definition_id:null,start:null,end:null,position_from_m:null,position_to_m:null},reason_code:reason}],raw,evidence_refs:[]};
}
function testConfig(metric){return {metric,environment:'SIMULATED',method:'POST',path:paths[metric],timezoneOffsetMinutes:480,percentScale:'PERCENT',gapUnit:'mm',sampleTimeField:'dataCreateTime',confirmed:false};}
module.exports={OVERLAP,GAP,paths,schemas,decimal,dateText,dateMillis,validateQuery,validateConfig,mapRecord,stableId,testConfig,insist};
