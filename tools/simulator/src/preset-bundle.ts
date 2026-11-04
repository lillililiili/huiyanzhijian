import {randomInt,createHash,randomUUID} from 'node:crypto';
import {previewSpecification,SpecificationStore,type Specification} from './specification';
import {insist,keys,metrics} from './cable-model';
import type {Queue} from './queue';
export function presetBundle(b:any){
 keys(b,['grade','length_m','speed_m_min','sampling_interval_ms','inputs','diameters','pitches']);
 insist([1,2,3].includes(b.grade),'请选择轻微、明显或严重');
 keys(b.inputs,['tape_width_mm','overlap_width_mm','wire_gap_mm','diameter_x_mm','diameter_y_mm','b_x_mm','b_y_mm','meter_delay_ms']);
 keys(b.diameters,[...metrics]);keys(b.pitches,[...metrics]);
 const g=b.grade-1,range=(a:number,c:number)=>a+(c-a)*randomInt(1000000)/1000000;
 return metrics.map(metric=>{
  const ov=metric==='OVALITY',fields=ov?['diameter_x_mm','diameter_y_mm','b_x_mm','b_y_mm','meter_delay_ms']:metric==='WIRE_GAP'?['wire_gap_mm']:['tape_width_mm','overlap_width_mm'];
  const data:Specification={algorithm:'process-profile.v5',name:['轻微','明显','严重'][g]+' · '+metric,metric,length_m:b.length_m,speed_m_min:b.speed_m_min,sampling_interval_ms:b.sampling_interval_ms,
   inputs:Object.fromEntries(fields.map(k=>[k,b.inputs[k]])),seed:randomInt(1000000000),
   noise_pct:range(...([[.05,.15],[.3,.5],[.8,1.2]][g] as [number,number])),
   anomaly_probability_pct:range(...([[2,4],[8,12],[20,30]][g] as [number,number])),
   anomaly_pct:range(...((ov?[[.3,.6],[1,1.5],[2.5,3.5]]:[[5,8],[18,25],[40,55]])[g] as [number,number])),
   defect_duration_ms:Math.max(8*b.sampling_interval_ms,Math.round(Number(b.diameters[metric])/1000*(ov?80:30)/Number(b.speed_m_min)*60000*range(.6,1.4))),
   process:{diameter_mm:Number(b.diameters[metric]),pitch_mm:Number(b.pitches[metric]),sheath_pct:range(...([[2,4],[10,15],[25,35]][g] as [number,number])),grade:b.grade}};
  return {data,...previewSpecification(data)};
 });
}
export function confirmBundle(q:Queue,store:SpecificationStore,b:any,source:any){
 keys(b,['request_id','cable_id','cable_version','items','reason']);insist(/^[a-f0-9-]{36}$/.test(b.request_id),'请求标识无效');
 insist(Array.isArray(b.items)&&b.items.length===3&&metrics.every(m=>b.items.filter((v:any)=>v.data?.metric===m).length===1),'须包含三路物理检测及同源护套结果');
 insist(b.items.every((v:any)=>v.data.algorithm==='process-profile.v5'&&v.data.length_m===b.items[0].data.length_m&&v.data.sampling_interval_ms===b.items[0].data.sampling_interval_ms),'同盘线长和采样间隔必须一致');
 const digest=createHash('sha256').update(JSON.stringify(b)).digest('hex');
 return q.transaction(()=>{
  const old=q.db.prepare('SELECT * FROM spec_confirmation WHERE request_id=?').get(b.request_id) as any;
  if(old){insist(old.digest===digest,'重复请求内容变化',409);return JSON.parse(old.result);}
  let version=b.cable_version;const results=[];
  for(const item of b.items){keys(item,['data','hash']);const r=store.confirm({request_id:randomUUID(),cable_id:b.cable_id,cable_version:version,spec_id:randomUUID(),spec_version:0,data:item.data,preview_hash:item.hash,reason:b.reason},source,true);version=r.cable_version;results.push(r);}
  const result={cable_id:b.cable_id,cable_version:version,results};q.db.prepare('INSERT INTO spec_confirmation VALUES(?,?,?)').run(b.request_id,digest,JSON.stringify(result));return result;
 });
}
