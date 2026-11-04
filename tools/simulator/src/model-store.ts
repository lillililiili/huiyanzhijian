import {samplingInterval,timeSampleCount,nominalStep} from './sampling';
import {type Specification,validateSpecification,specificationPoint} from './specification';
import type {Queue} from './queue';
import {createHash} from 'node:crypto';
import {type Cable,validateCable,observeCable,fixed,decimal,insist,keys,named} from './cable-model';
import {type Detector,validateDetector,detect} from './device-model';
export type Snapshot={cable:{id:string;version:number;data:Cable};detector:{id:string;version:number;data:Detector};interval_ms:number;count:number;specification?:{id:string;version:number;data:Specification};edge_sync?:{distanceMm:number;revision:string;runId:string}};
export function initialiseModels(q:Queue){q.db.exec(`CREATE TABLE IF NOT EXISTS model_revision(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(kind,id,version));
 CREATE TABLE IF NOT EXISTS model_pass(run_id TEXT PRIMARY KEY,input_hash TEXT NOT NULL,snapshot TEXT NOT NULL,mode TEXT NOT NULL,device_id TEXT NOT NULL,event_input TEXT NOT NULL,enter_response TEXT,exit_response TEXT,exit_error TEXT,created_at TEXT NOT NULL);`);}
export class ModelStore{
 constructor(readonly q:Queue){initialiseModels(q);}
 list(kind:string){insist(['cables','detectors'].includes(kind),'模型种类无效');return this.q.db.prepare('SELECT r.* FROM model_revision r WHERE kind=? AND version=(SELECT max(version) FROM model_revision x WHERE x.kind=r.kind AND x.id=r.id) ORDER BY created_at DESC LIMIT 100').all(kind).map((r:any)=>({...r,data:JSON.parse(r.data),inspection:this.inspection(kind,r.id,r.version)}));}
 inspection(kind:string,id:string,version:number){
  const model=kind==='cables'?'cable':'detector';
  return this.q.db.prepare(`SELECT count(*) AS runs,
   coalesce(sum(json_extract(p.snapshot,'$.${model}.version')=?),0) AS current_runs,
   coalesce(sum(json_extract(p.snapshot,'$.${model}.version')=? AND r.target>0 AND r.generated>=r.target),0) AS completed,
   coalesce(sum(json_extract(p.snapshot,'$.${model}.version')=? AND coalesce(r.generated,0)>0 AND r.generated<r.target),0) AS partial
   FROM model_pass p LEFT JOIN sim_run r ON r.id=p.run_id WHERE json_extract(p.snapshot,'$.${model}.id')=?`).get(version,version,version,id);
 }
 history(kind:string,id:string,page:number){
  insist(['cables','detectors'].includes(kind),'模型种类无效');this.get(kind,id);
  insist(Number.isSafeInteger(page)&&page>=1,'页码无效');const model=kind==='cables'?'cable':'detector';
  const total=Number(this.q.db.prepare(`SELECT count(*) AS n FROM model_pass WHERE json_extract(snapshot,'$.${model}.id')=?`).get(id)?.n||0);
  const rows=this.q.db.prepare(`SELECT p.run_id,p.snapshot,p.created_at,p.mode,p.exit_error,r.generated,r.target,r.control,
   (SELECT count(*) FROM sample s WHERE s.run_id=p.run_id AND s.state IN ('PENDING','UNKNOWN')) AS pending,
   (SELECT count(*) FROM sample s WHERE s.run_id=p.run_id AND s.state='STORED') AS stored
   FROM model_pass p LEFT JOIN sim_run r ON r.id=p.run_id WHERE json_extract(p.snapshot,'$.${model}.id')=? ORDER BY p.created_at DESC,p.run_id DESC LIMIT 20 OFFSET ?`).all(id,(page-1)*20).map((r:any)=>{const s=JSON.parse(r.snapshot);return {...r,snapshot:undefined,cable:s.cable,detector:s.detector};});
  return {items:rows,total,page,limit:20};
 }
 get(kind:string,id:string,version?:number):any{const r=this.q.db.prepare('SELECT * FROM model_revision WHERE kind=? AND id=? AND (? IS NULL OR version=?) ORDER BY version DESC LIMIT 1').get(kind,id,version??null,version??null) as any;insist(r,'模型不存在',404,'MODEL_NOT_FOUND');return {...r,data:JSON.parse(r.data)};}
 save(kind:string,b:any){insist(['cables','detectors'].includes(kind),'模型种类无效');keys(b,['id','version','data','reason']);insist(typeof b.id==='string'&&/^[a-f0-9-]{36}$/.test(b.id),'模型ID必须为UUID');insist(Number.isInteger(b.version)&&b.version>=0,'模型版本无效');named(b.reason,500);if(kind==='cables')validateCable(b.data);else validateDetector(b.data);
  return this.q.transaction(()=>{const prior=this.q.db.prepare('SELECT max(version) AS v FROM model_revision WHERE kind=? AND id=?').get(kind,b.id) as any;const current=Number(prior.v||0);if(kind==='cables'){
    const before=current?this.get(kind,b.id).data:null;const linked=before?.material_ref?.startsWith('platform:');if(before?.simulation_specs){insist(fixed(b.data.length_m)===fixed(before.length_m),'已关联规格的线缆请从规格配置修改线长');b.data.simulation_specs=before.simulation_specs;}
    if(linked)insist(b.data.material_ref===before.material_ref,'平台关联不可移除或改绑',409,'CATALOG_LINK_IMMUTABLE');
    if(b.data.material_ref.startsWith('platform:'))insist(b.data.material_ref==='platform:'+b.id,'预设ID与平台线缆必须一致',409,'CATALOG_LINK_MISMATCH');
   }const next=this.q.db.prepare('SELECT * FROM model_revision WHERE kind=? AND id=? AND version=?').get(kind,b.id,b.version+1) as any;
   if(next&&next.data===JSON.stringify(b.data)&&next.reason===b.reason)return {...next,data:JSON.parse(next.data)};
   insist(current===b.version,'模型已修改，请刷新版本后重试',412,'MODEL_VERSION_CONFLICT');this.q.db.prepare('INSERT INTO model_revision VALUES(?,?,?,?,?,?)').run(kind,b.id,current+1,JSON.stringify(b.data),b.reason,new Date().toISOString());return this.get(kind,b.id);});
 }
 snapshot(cableId:string,detectorId:string,cableVersion:number,detectorVersion:number):Snapshot{
  const cable=this.get('cables',cableId,cableVersion),detector=this.get('detectors',detectorId,detectorVersion);
  let specification;const refs=cable.data.simulation_specs;
  if(refs){const ref=refs[detector.data.metric];insist(ref,'请先确认此线缆对应检测项的规格与随机预览');specification=this.get('specs',ref.id,ref.version);validateSpecification(specification.data);insist(specification.data.metric===detector.data.metric&&fixed(specification.data.length_m)===fixed(cable.data.length_m),'冻结规格与线缆不一致');const spec=specification.data;detector.data={...detector.data,step_m:spec.algorithm!=='seeded-point.v1'?nominalStep(spec.speed_m_min,spec.sampling_interval_ms):spec.step_m,sampling_interval_ms:spec.algorithm!=='seeded-point.v1'?spec.sampling_interval_ms:undefined,speed_m_min:spec.speed_m_min,...(spec.metric==='OVALITY'?{meter_delay_ms:spec.inputs.meter_delay_ms,b_x_mm:spec.inputs.b_x_mm,b_y_mm:spec.inputs.b_y_mm}:{})};}
  const length=fixed(cable.data.length_m),timed=detector.data.sampling_interval_ms!==undefined;
  const interval=timed?samplingInterval(detector.data.sampling_interval_ms):Math.round(Number(fixed(detector.data.step_m))/Number(fixed(detector.data.speed_m_min))*60000);
  insist(interval>=(timed?1:50)&&interval<=60000,'采样间隔超出允许范围');
  const count=timed?timeSampleCount(cable.data.length_m,detector.data.speed_m_min,interval):Number((length+fixed(detector.data.step_m)-1n)/fixed(detector.data.step_m));insist(count>=1&&count<=100000,'采样数量须为1～100000，请调整线长或采样间隔');
  return {cable,detector,count,interval_ms:interval,...(specification?{specification}: {})};
 }
 pass(id:string):any{const r=this.q.db.prepare('SELECT * FROM model_pass WHERE run_id=?').get(id) as any;return r?{...r,snapshot:JSON.parse(r.snapshot),event_input:JSON.parse(r.event_input),enter_response:r.enter_response?JSON.parse(r.enter_response):null,exit_response:r.exit_response?JSON.parse(r.exit_response):null}:null;}
 comparison(id:string){const p=this.pass(id);if(!p)return null;const s:Snapshot=p.snapshot;const generated=Number(this.q.db.prepare('SELECT count(*) AS n FROM sample WHERE run_id=?').get(id)?.n||0),step=fixed(s.detector.data.step_m);
  const tests=s.cable.data.defects.map(d=>{const start=fixed(d.start_m),end=start+fixed(d.length_m),relevant=d.metric===s.detector.data.metric;
   const range=this.q.db.prepare("SELECT count(*) AS n,sum(CASE WHEN coalesce((SELECT json_extract(v.context_json,'$.simulation_result') FROM vendor_http_sample v WHERE v.record_id=sample.record_id),json_extract(payload,'$.values[0].source_quality_result'))='FAIL' THEN 1 ELSE 0 END) AS failures FROM sample WHERE run_id=? AND CAST(json_extract(payload,'$.position_m') AS REAL)>=? AND CAST(json_extract(payload,'$.position_m') AS REAL)<?").get(id,Number(d.start_m),Number(d.start_m)+Number(d.length_m)) as any;
   const sampled=relevant?Number(range.n):0,detected=relevant?Number(range.failures||0):0;
   return {...d,relevant,sampled,detected,status:!relevant?'非本设备指标':!sampled?'尚未采到该区段':detected?'已检出':'采到但未触发设备界限'};});
  const allFails=Number(this.q.db.prepare("SELECT count(*) AS n FROM sample WHERE run_id=? AND coalesce((SELECT json_extract(v.context_json,'$.simulation_result') FROM vendor_http_sample v WHERE v.record_id=sample.record_id),json_extract(payload,'$.values[0].source_quality_result'))='FAIL'").get(id)?.n||0);
  return {run_id:id,mode:p.mode,cable:s.cable,detector:s.detector,expected_samples:this.q.run(id)?.target??s.count,generated,unexpected_device_failures:allFails-tests.reduce((n,d)=>n+d.detected,0),defects:tests,enter:p.enter_response,exit:p.exit_response,exit_error:p.exit_error,unit:s.detector.data.metric==='WIRE_GAP'?'mm':'%',notice:'仅模拟测试对比；采样间隙不算有效覆盖，预设缺陷未发送平台'};
 }
}
export function hashInput(v:unknown){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
export function modelRecord(run:any,sequence:number,s:Snapshot,timedPosition?:bigint){const a=JSON.parse(run.assignment),position=timedPosition??BigInt(sequence-1)*fixed(s.detector.data.step_m);insist(sequence>=1&&sequence<=(s.detector.data.sampling_interval_ms!==undefined?100000:s.count),'采样序号越界');insist(a.metric_code===s.detector.data.metric,'设备模型与任务检测项不一致');
 const point=s.specification?specificationPoint(s.specification.data,sequence-1,Number(decimal(position))):null;
 const bX=point?.b_x_mm??s.detector.data.b_x_mm,bY=point?.b_y_mm??s.detector.data.b_y_mm;
 const meter=s.detector.data.meter_delay_ms,now=new Date().toISOString();
 const edgeSimulation=s.detector.data.metric==='OVALITY'&&meter!==undefined&&meter!==''&&s.edge_sync?{meter:{delay_ms:Number(meter),distance_mm:s.edge_sync.distanceMm,sync_revision:s.edge_sync.revision,source:'SIMULATED',record_id:run.id+'-'+sequence+'-meter',sample_time:now},...(bX?{gauge_b:{values:[bX,...(bY?[bY]:[])],sample_time:new Date(Date.parse(now)-Number(meter)).toISOString(),status:'VALID'}}:{})}:null;
 const taskMethod=a.rule_snapshot?.method_id;
 const comparison=a.rule_snapshot?.comparison;
 const detector=taskMethod==='roundness-min-max.v1'&&comparison?{...s.detector.data,lower:comparison.lower??'',upper:comparison.upper??''}:s.detector.data;
 const measured=detect(detector,point?.geometry??observeCable(s.cable.data,position),taskMethod==='roundness-min-max.v1'?'roundness-min-max.v1':'legacy-percent');const rawVersion=a.metric_code==='SHIELD_OVERLAP_RATE'?'overlap-sim.v1':a.metric_code==='WIRE_GAP'?'wire-gap-sim.v1':'diameter-aux-sim.v1';
 // A simulated instrument reports the method frozen in its bound task. This
 // keeps M04 evaluation tied to the task snapshot instead of a simulator-only ID.
 const methodId=typeof a.rule_snapshot?.method_id==='string'?a.rule_snapshot.method_id:'sim02-'+a.metric_code.toLowerCase();
 return {record_id:run.id+'-'+sequence,device_id:run.device_id,capture_session_id:run.capture_session,capture_sequence:String(sequence),source_record_id:null,source_session_id:null,source_sequence:null,sample_kind:'NEW_SAMPLE',task_id:a.task_id,binding_id:a.binding_id,binding_version:a.binding_version,sample_time:now,time_source:'SIMULATOR',position_m:decimal(position),position_quality:'KNOWN',position_segment_id:run.id+'-segment',source_type:'DEVICE',data_environment:'SIMULATED',data_status:'VALID',recipe_version_id:a.recipe_version_id,
 values:[{metric_code:a.metric_code,value:measured.value,unit:measured.unit,data_status:'VALID',source_quality_result:measured.result,method_id:methodId,window:{kind:'INSTANT',definition_id:null,start:null,end:null,position_from_m:null,position_to_m:null},reason_code:null}],
 raw:{schema_version:rawVersion,data:{...(s.specification?{simulation_specification_id:s.specification.id,simulation_specification_version:String(s.specification.version)}:{}),...(edgeSimulation?{edge_simulation:edgeSimulation}:{}),provided_scalar:measured.value,observation:measured.observation,algorithm:measured.algorithm,detector_model_id:s.detector.id,detector_version:String(s.detector.version),test_limits:{lower:detector.lower||null,upper:detector.upper||null},simulation_model:'SIM02',test_only:true,notice:'Test detector observation; no certified instrument accuracy or physical coverage claim'}},evidence_refs:[]};
}
