// Detector receives a local observation, never the cable's defect list.
import {type Geometry,type Metric,metrics,keys,named,fixed,insist} from './cable-model';
export type Detector={name:string;device_id:string;metric:Metric;step_m:string;speed_m_min:string;lower:string;upper:string};
export function validateDetector(d:Detector){keys(d,['name','device_id','metric','step_m','speed_m_min','lower','upper']);named(d.name);insist(typeof d.device_id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,89}$/.test(d.device_id),'设备标识无效');insist(metrics.includes(d.metric),'不支持的检测项');insist(fixed(d.step_m)>0n&&fixed(d.speed_m_min,600)>0n,'采样步长和线速必须大于0');insist(d.lower!==''||d.upper!=='','至少设置一个测试检测界限');if(d.lower!=='')fixed(d.lower);if(d.upper!=='')fixed(d.upper);if(d.lower!==''&&d.upper!=='')insist(fixed(d.lower)<=fixed(d.upper),'下限不能大于上限');return d;}
export function detect(d:Detector,g:Geometry){
 const n=(v:string)=>Number(v),unit=d.metric==='WIRE_GAP'?'mm':'%';
 const measured=d.metric==='SHIELD_OVERLAP_RATE'?100*n(g.overlap_width_mm)/n(g.tape_width_mm):d.metric==='WIRE_GAP'?n(g.wire_gap_mm):200*Math.abs(n(g.diameter_x_mm)-n(g.diameter_y_mm))/(n(g.diameter_x_mm)+n(g.diameter_y_mm));
 const value=measured.toFixed(10).replace(/0+$/,'').replace(/\.$/,'');
 const abnormal=d.lower!==''&&Number(value)<n(d.lower)||d.upper!==''&&Number(value)>n(d.upper);
 const observation=d.metric==='SHIELD_OVERLAP_RATE'?{tape_width_mm:g.tape_width_mm,overlap_width_mm:g.overlap_width_mm}:d.metric==='WIRE_GAP'?{wire_gap_mm:g.wire_gap_mm}:{diameter_x_mm:g.diameter_x_mm,diameter_y_mm:g.diameter_y_mm,ovality_difference_mm:Math.abs(n(g.diameter_x_mm)-n(g.diameter_y_mm)).toFixed(6)};
 return {value,unit,result:abnormal?'FAIL':'PASS',observation,algorithm:d.metric==='OVALITY'?'sim-legacy-percent-mean.v1':d.metric==='SHIELD_OVERLAP_RATE'?'sim-overlap-width-ratio.v1':'sim-wire-gap-direct.v1'};
}
