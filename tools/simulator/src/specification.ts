import {continuousObservation,profileSegments} from './continuous-profile';
import {samplingInterval,timeSampleCount,timePosition} from './sampling';
import {createHash} from 'node:crypto';
import {type Geometry,type Metric,metrics,fixed,decimal,insist,keys,named} from './cable-model';
import type {Queue} from './queue';

export type Specification={algorithm:'seeded-point.v1'|'seeded-time.v2'|'seeded-profile.v3'|'seeded-perimeter.v4';name:string;metric:Metric;length_m:string;step_m?:string;sampling_interval_ms?:number;defect_duration_ms?:number;speed_m_min:string;inputs:Record<string,string>;noise_pct:number;anomaly_probability_pct:number;anomaly_pct:number;seed:number};
export const inputKeys:Record<Metric,string[]>={SHIELD_OVERLAP_RATE:['tape_width_mm','overlap_width_mm'],WIRE_GAP:['wire_gap_mm'],OVALITY:['diameter_x_mm','diameter_y_mm','b_x_mm','b_y_mm','meter_delay_ms']};
const base:Geometry={tape_width_mm:'20',overlap_width_mm:'2.5',wire_gap_mm:'1.25',diameter_x_mm:'40',diameter_y_mm:'40'};
export function validateSpecification(s:Specification){
 keys(s,['algorithm','name','metric','length_m',...(s.algorithm!=='seeded-point.v1'?['sampling_interval_ms']:['step_m']),'speed_m_min','inputs','noise_pct','anomaly_probability_pct','anomaly_pct','seed',...((s.algorithm==='seeded-profile.v3'||s.algorithm==='seeded-perimeter.v4')?['defect_duration_ms']:[])]);insist(['seeded-point.v1','seeded-time.v2','seeded-profile.v3','seeded-perimeter.v4'].includes(s.algorithm),'随机算法版本无效');named(s.name);insist(metrics.includes(s.metric),'请选择检测项');keys(s.inputs,inputKeys[s.metric]);
 const length=fixed(s.length_m),speed=fixed(s.speed_m_min,600);insist(length>0n&&speed>0n,'线长和送料速度必须大于0');
 let count:number;
 if(s.algorithm!=='seeded-point.v1'){count=timeSampleCount(s.length_m,s.speed_m_min,samplingInterval(s.sampling_interval_ms));}
 else {const step=fixed(s.step_m!);insist(step>0n,'历史采样步长必须大于0');count=Number((length+step-1n)/step);const interval=Math.round(Number(step)/Number(speed)*60000);insist(interval>=50&&interval<=60000,'历史步长与速度间隔须为50～60000ms');}
 insist(count<=10000,'预览最多10000个采样点，请增大采样间隔或缩短线长');
 for(const [k,v] of Object.entries(s.inputs)){
  if(k==='b_y_mm'&&v==='')continue;
  if(k==='meter_delay_ms'){insist(typeof v==='string'&&/^\d{1,7}$/.test(v)&&Number(v)<=3600000,'计米器输出须为0～3600000整数ms');continue;}
  const n=fixed(v,1000);insist(n>0n||k==='wire_gap_mm'||k==='overlap_width_mm','直径与带宽须大于0');if(s.metric==='OVALITY')insist(n>=10000n&&n<=655350000n,'模拟寄存器范围内直径须为0.01～655.35mm');
 }
 if(s.metric==='SHIELD_OVERLAP_RATE')insist(fixed(s.inputs.overlap_width_mm)<=fixed(s.inputs.tape_width_mm),'搭盖宽度不能大于铜带宽度');
 for(const k of ['noise_pct','anomaly_probability_pct','anomaly_pct'] as const)insist(typeof s[k]==='number'&&Number.isFinite(s[k])&&s[k]>=0&&s[k]<=100,'随机比例须为0～100');
 insist((s.algorithm==='seeded-profile.v3'||s.algorithm==='seeded-perimeter.v4')||s.anomaly_probability_pct===0||s.anomaly_pct>s.noise_pct,'异常变化幅度必须大于正常波动幅度');insist(Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=999999999,'随机种子须为0～999999999整数');if((s.algorithm==='seeded-profile.v3'||s.algorithm==='seeded-perimeter.v4')){
  insist(s.metric==='OVALITY','连续区段算法仅用于不圆度');
  if(s.algorithm==='seeded-perimeter.v4')insist(fixed(s.inputs.diameter_x_mm)===fixed(s.inputs.diameter_y_mm),'固定周长模式请填写一个原始圆直径，X/Y基准必须相同');
  insist(Number.isInteger(s.defect_duration_ms)&&s.defect_duration_ms!>=8*s.sampling_interval_ms!&&s.defect_duration_ms!<=600000,'典型缺陷经过时间须为整数ms，至少8个采样间隔，最多600000ms');
  insist(s.anomaly_probability_pct===0||s.anomaly_pct>0,'启用缺陷区段时，轴向变形峰值须大于0');
  const active=Number(s.length_m)/Number(s.speed_m_min)*60000*s.anomaly_probability_pct/100;
  insist(!active||active>=8*s.sampling_interval_ms!,'当前线长和占比不足以形成8个采样间隔的缺陷，请减小采样间隔或增大线长/占比');
 }return count;
}

// Index based PRNG: preview, restarted production and retries use identical points.
export function specificationPoint(s:Specification,index:number,positionM?:number){
 if((s.algorithm==='seeded-profile.v3'||s.algorithm==='seeded-perimeter.v4')){
  const position=positionM??Number(decimal(timePosition(index,s.speed_m_min,s.sampling_interval_ms!)));
  const v=continuousObservation(s,position),geometry={...base,diameter_x_mm:v.diameter_x_mm,diameter_y_mm:v.diameter_y_mm};
  const x=Number(v.diameter_x_mm),y=Number(v.diameter_y_mm);
  return {index,elapsed_ms:index*s.sampling_interval_ms!,position_m:position.toFixed(6),injected:v.injected,clipped:v.clipped,...('perimeter_mm' in v?{perimeter_mm:v.perimeter_mm,perimeter_error_mm:v.perimeter_error_mm}:{}),geometry,b_x_mm:v.b_x_mm,b_y_mm:v.b_y_mm,meter_delay_ms:s.inputs.meter_delay_ms,metric_value:Math.min(x,y)/Math.max(x,y),sheath_mm:(x+y)/2-(v.b_y_mm===undefined?Number(v.b_x_mm):(Number(v.b_x_mm)+Number(v.b_y_mm))/2)};
 }

 let state=(s.seed^Math.imul(index+1,0x9e3779b1))>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const injected=random()*100<s.anomaly_probability_pct;
 const g:Geometry={...base};for(const k of Object.keys(g) as (keyof Geometry)[])if(s.inputs[k]!==undefined)g[k]=s.inputs[k];
 const value=(v:string,sign=0)=>{const n=Number(v),offset=injected&&sign?sign*s.anomaly_pct/100*(0.8+random()*0.2):(random()*2-1)*s.noise_pct/100;return Math.max(s.metric==='OVALITY'?0.01:0,Math.min(s.metric==='OVALITY'?655.35:1000,n*(1+offset))).toFixed(6);};
 let bx:string|undefined,by:string|undefined;
 if(s.metric==='SHIELD_OVERLAP_RATE'){g.overlap_width_mm=value(s.inputs.overlap_width_mm,-1);g.overlap_width_mm=Math.min(Number(g.tape_width_mm),Number(g.overlap_width_mm)).toFixed(6);}
 if(s.metric==='WIRE_GAP')g.wire_gap_mm=value(s.inputs.wire_gap_mm,1);
 if(s.metric==='OVALITY'){g.diameter_x_mm=value(s.inputs.diameter_x_mm);g.diameter_y_mm=value(s.inputs.diameter_y_mm,1);bx=value(s.inputs.b_x_mm);if(s.inputs.b_y_mm!=='')by=value(s.inputs.b_y_mm);}
 const x=Number(g.diameter_x_mm),y=Number(g.diameter_y_mm),metricValue=s.metric==='OVALITY'?Math.min(x,y)/Math.max(x,y):s.metric==='WIRE_GAP'?Number(g.wire_gap_mm):100*Number(g.overlap_width_mm)/Number(g.tape_width_mm);
 return {index,elapsed_ms:s.algorithm!=='seeded-point.v1'?index*s.sampling_interval_ms!:Math.round(index*Number(s.step_m)/Number(s.speed_m_min)*60000),position_m:decimal(s.algorithm!=='seeded-point.v1'?timePosition(index,s.speed_m_min,s.sampling_interval_ms!):BigInt(index)*fixed(s.step_m!)),injected,geometry:g,b_x_mm:bx,b_y_mm:by,meter_delay_ms:s.inputs.meter_delay_ms,metric_value:metricValue,sheath_mm:bx===undefined?null:(x+y)/2-(by===undefined?Number(bx):(Number(bx)+Number(by))/2)};
}
export function previewSpecification(data:Specification){
 const count=validateSpecification(data),points=Array.from({length:count},(_,i)=>specificationPoint(data,i));
 const segments=(data.algorithm==='seeded-profile.v3'||data.algorithm==='seeded-perimeter.v4')?profileSegments(data).map((s,i)=>({number:i+1,start_m:(s.start_ms*Number(data.speed_m_min)/60000).toFixed(6),end_m:(s.end_ms*Number(data.speed_m_min)/60000).toFixed(6),duration_ms:Math.round(s.end_ms-s.start_ms),peak_pct:Number((s.strength*data.anomaly_pct).toFixed(4))})):[];
 return {hash:createHash('sha256').update(JSON.stringify(data)).digest('hex'),count,injected:points.filter(p=>p.injected).length,points,segments,...(data.algorithm==='seeded-perimeter.v4'?{reference_perimeter_mm:Math.PI*Number(data.inputs.diameter_x_mm),max_perimeter_error_mm:Math.max(...points.map(p=>'perimeter_error_mm' in p?Math.abs(Number(p.perimeter_error_mm)):0))}:{}),clipped:points.filter(p=>'clipped' in p&&p.clipped).length};
}

export class SpecificationStore {
 constructor(private q:Queue){q.db.exec('CREATE TABLE IF NOT EXISTS spec_confirmation(request_id TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL)');}
 list(){return this.q.db.prepare("SELECT r.* FROM model_revision r WHERE kind='specs' AND version=(SELECT max(version) FROM model_revision x WHERE x.kind=r.kind AND x.id=r.id) ORDER BY created_at DESC LIMIT 500").all().map((r:any)=>({...r,data:JSON.parse(r.data)}));}
 confirm(b:any,source:any){
  keys(b,['request_id','cable_id','cable_version','spec_id','spec_version','data','preview_hash','reason']);for(const k of ['request_id','cable_id','spec_id'])insist(typeof b[k]==='string'&&/^[a-f0-9-]{36}$/.test(b[k]),'标识无效');for(const k of ['cable_version','spec_version'])insist(Number.isInteger(b[k])&&b[k]>=0,'版本无效');named(b.reason,500);
  const preview=previewSpecification(b.data);insist(preview.hash===b.preview_hash,'参数已变化，请重新预览再确认');
  const digest=createHash('sha256').update(JSON.stringify(b)).digest('hex');
  return this.q.transaction(()=>{
   const receipt=this.q.db.prepare('SELECT * FROM spec_confirmation WHERE request_id=?').get(b.request_id) as any;if(receipt){insist(receipt.digest===digest,'相同确认请求内容冲突',409);return JSON.parse(receipt.result);}
   const latest=(kind:string,id:string)=>this.q.db.prepare('SELECT * FROM model_revision WHERE kind=? AND id=? ORDER BY version DESC LIMIT 1').get(kind,id) as any;
   const spec=latest('specs',b.spec_id),cable=latest('cables',b.cable_id);insist(Number(spec?.version||0)===b.spec_version&&Number(cable?.version||0)===b.cable_version,'规格或线缆已被修改，请刷新后重新预览',409);
   const c=cable?JSON.parse(cable.data):{name:source.spool_code,material_ref:'platform:'+b.cable_id,length_m:b.data.length_m,baseline:base,defects:[]};
   insist(c.material_ref==='platform:'+b.cable_id,'线缆平台关联不一致');
   const refs=c.simulation_specs||{};insist(!Object.keys(refs).some(k=>k!==b.data.metric)||fixed(c.length_m)===fixed(b.data.length_m),'同盘三项共用线长，请保持已有线长或另选线缆');
   c.length_m=b.data.length_m;c.simulation_specs={...refs,[b.data.metric]:{id:b.spec_id,version:b.spec_version+1}};
   const now=new Date().toISOString();this.q.db.prepare('INSERT INTO model_revision VALUES(?,?,?,?,?,?)').run('specs',b.spec_id,b.spec_version+1,JSON.stringify(b.data),b.reason,now);this.q.db.prepare('INSERT INTO model_revision VALUES(?,?,?,?,?,?)').run('cables',b.cable_id,b.cable_version+1,JSON.stringify(c),b.reason,now);
   const result={spec_id:b.spec_id,spec_version:b.spec_version+1,cable_id:b.cable_id,cable_version:b.cable_version+1,preview_hash:preview.hash,count:preview.count,injected:preview.injected};this.q.db.prepare('INSERT INTO spec_confirmation VALUES(?,?,?)').run(b.request_id,digest,JSON.stringify(result));return result;
  });
 }
}
