import type {WebManager} from './web-manager';
import {insist,keys} from './cable-model';

const physicalMetrics=['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'];

// Availability is advisory. createPass revalidates current assignments and takes
// the per-device lock before starting a producer, including concurrent requests.
export async function feedOptions(m:WebManager){
 const catalog=await m.catalog({page:'1',limit:'1'});
 const devices=catalog.devices.filter((d:any)=>d.enabled&&d.model&&physicalMetrics.includes(d.metric_code));
 const spoolIds=[...new Set<string>(devices.map((d:any)=>d.platform_assignment?.spool_id).filter(Boolean))];
 const rows=(await Promise.all(spoolIds.map(id=>m.catalog({id})))).flatMap(r=>r.items);
 const jobs=m.queue.db.prepare("SELECT device_id FROM web_execution WHERE status IN('STARTING','RUNNING','STOPPING')").all() as any[];
 const leases=m.queue.db.prepare('SELECT device_id FROM producer_lease WHERE expires_at>?').all(Date.now()) as any[];
 let edge:any=null,edgeError='';
 if(devices.some((d:any)=>d.metric_code==='OVALITY'&&d.platform_assignment)){
  try{edge=await m.scannerState();}catch(e){edgeError=(e as Error).message;}
 }
 const cables:any[]=[],unavailable:any[]=[];
 for(const d of devices){
  const a=d.platform_assignment,row=rows.find((r:any)=>r.id===a?.spool_id),task=row?.tasks.find((t:any)=>t.id===a?.task_id&&t.device_id===d.id&&t.metric_code===d.metric_code&&t.state==='RUNNING');
  let reason=!a||!task?'请先扫码绑定运行任务':!row?.model?'请先配置线缆规格与缺陷':jobs.some(j=>j.device_id===d.id)||leases.some(j=>j.device_id===d.id)?'设备正在送料或停止中':'';
  let snapshot:any;
  if(!reason){try{snapshot=m.models.snapshot(row.id,d.model_id,row.model.version,d.model.version);}catch(e){reason=(e as Error).message;}}
  if(!reason&&d.metric_code==='OVALITY'){
   if(edgeError)reason=edgeError;
   else if(edge?.state!=='RUNNING'||edge.run?.taskId!==task.id||edge.run?.config?.deviceId!==d.id)reason='边缘尚未绑定此任务，请开机后扫码';
   else if(snapshot.detector.data.meter_delay_ms!==undefined&&snapshot.detector.data.meter_delay_ms!==''&&!(edge.run.config.sync?.distanceMm>0))reason='请配置并推送测径仪间距后重新扫码';
  }
  if(reason){unavailable.push({device_id:d.id,reason});continue;}
  const paired=task.companion_task?.state==='RUNNING'?task.companion_task:null;
  const route={device_id:d.id,name:d.name,metric_code:d.metric_code,task_id:task.id,task_code:task.task_code,
   metrics:paired?[d.metric_code,'SHEATH_THICKNESS']:[d.metric_code],paired_task_id:paired?.id??null,paired_task_code:paired?.task_code??null,
   count:snapshot.count,interval_ms:snapshot.interval_ms,speed_m_min:snapshot.detector.data.speed_m_min,
   input:{cable_id:row.id,cable_version:row.model.version,detector_id:d.model_id,detector_version:d.model.version,mode:'BOUND',task_id:task.id,spool_id:row.id}};
  let cable=cables.find(c=>c.id===row.id);
  if(!cable){cable={id:row.id,name:row.spool_code,order:row.external_code,length_m:snapshot.cable.data.length_m,routes:[]};cables.push(cable);}
  cable.routes.push(route);
 }
 return {cables,unavailable,checked_at:new Date().toISOString()};
}

export async function parallelPasses(m:WebManager,b:any){
 keys(b,['items']);insist(Array.isArray(b.items)&&b.items.length>0&&b.items.length<=16,'请选择1至16路设备');
 const devices=new Set<string>(),requests=new Set<string>(),cables=new Set<string>();
 // Validate the entire selection before any side effect. Retry uses exactly the
 // original per-route body; a successful route is not restarted.
 for(const item of b.items){
  insist(item&&item.mode==='BOUND','批量送料仅使用已扫码绑定任务');
  insist(typeof item.request_id==='string'&&/^[a-f0-9-]{36}$/.test(item.request_id)&&!requests.has(item.request_id),'请求标识重复或无效');requests.add(item.request_id);
  const detector=m.models.get('detectors',item.detector_id,item.detector_version);
  insist(physicalMetrics.includes(detector.data.metric),'护套与不圆度共用一次物理送料');
  insist(!devices.has(detector.data.device_id),'同一物理设备不能重复选择');devices.add(detector.data.device_id);cables.add(item.cable_id);
 }
 insist(cables.size===1,'一次批量送料请选择同一盘线缆');
 const results=await Promise.all(b.items.map(async(input:any)=>{
  try{return {request_id:input.request_id,task_id:input.task_id,ok:true,job:await m.createPass(input)};}
  catch(e){const err=e as any;return {request_id:input.request_id,task_id:input.task_id,ok:false,code:err.code||'FEED_FAILED',message:err.code?err.message:'送料未确认，请使用原请求重试'};}
 }));
 return {results,started:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
}

export async function scannerStates(m:WebManager){
 const profile=(await m.client.request('/ingestion/profile','ProfileResponse')).data;
 insist(profile.data_environment==='SIMULATED','设备凭据不允许访问模拟器',403);
 const devices=profile.devices.filter((d:any)=>d.metric_codes.some((metric:string)=>physicalMetrics.includes(metric)));
 return {devices:await Promise.all(devices.map(async(d:any)=>{
  const metric=d.metric_codes.find((v:string)=>physicalMetrics.includes(v)),adapter=metric==='OVALITY'?'EDGE':'ODM';
  try{const state=await m.scannerState(adapter==='ODM'?d.device_id:undefined);
   if(adapter==='EDGE'&&state.run&&state.run.config?.deviceId!==d.device_id)return {device_id:d.device_id,metric_code:metric,adapter,error:'此设备未连接当前边缘终端'};
   return {device_id:d.device_id,metric_code:metric,adapter,state};
  }catch(e){return {device_id:d.device_id,metric_code:metric,adapter,error:(e as Error).message};}
 })),checked_at:new Date().toISOString()};
}
