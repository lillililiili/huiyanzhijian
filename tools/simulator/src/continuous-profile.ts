import {fixedPerimeterAxes} from './ellipse-perimeter';
import type {Specification} from './specification';

// Engineering simulation, not calibrated instrument noise or a production tolerance.
// Hash each channel/key before drawing: avoids the correlated first LCG draw of v1/v2.
function random(seed:number,key:number,channel:number){
 let x=(seed^Math.imul(key+1,0x9e3779b1)^Math.imul(channel+1,0x85ebca6b))>>>0;
 x=Math.imul(x^(x>>>16),0x7feb352d);x=Math.imul(x^(x>>>15),0x846ca68b);
 return ((x^(x>>>16))>>>0)/4294967296;
}
function smooth(seed:number,t:number,scale:number,channel:number){
 const k=Math.floor(t/scale),u=t/scale-k,w=u*u*(3-2*u);
 return 2*((1-w)*random(seed,k,channel)+w*random(seed,k+1,channel))-1;
}
export type ProfileSegment={start_ms:number;end_ms:number;strength:number;ramp:number};
const cache=new WeakMap<Specification,ProfileSegment[]>();
export function profileSegments(s:Specification){
 const cached=cache.get(s);if(cached)return cached;
 const total=Number(s.length_m)/Number(s.speed_m_min)*60000;
 const active=total*s.anomaly_probability_pct/100,clear=total-active,dt=s.sampling_interval_ms!;
 const result:ProfileSegment[]=[];
 if(active>0){
  const n=Math.max(1,Math.min(500,Math.round(active/s.defect_duration_ms!),Math.floor(active/(8*dt)),Math.floor(clear/(2*dt))+1));
  const sizes=Array.from({length:n},(_,i)=>0.8+0.4*random(s.seed,i,100));
  const gaps=Array.from({length:n+1},(_,i)=>-Math.log(Math.max(1e-9,random(s.seed,i,101))));
  const sizeSum=sizes.reduce((a,b)=>a+b,0),gapSum=gaps.reduce((a,b)=>a+b,0);
  const minimumGap=n>1?Math.min(2*dt,clear/(n-1)):0,extraClear=Math.max(0,clear-minimumGap*(n-1));
  let cursor=0;
  for(let i=0;i<n;i++){
   cursor+=extraClear*gaps[i]/gapSum+(i?minimumGap:0);
   const end=cursor+active*sizes[i]/sizeSum;
   result.push({start_ms:cursor,end_ms:end,strength:0.35+0.65*random(s.seed,i,102)**2,ramp:0.25+0.25*random(s.seed,i,103)});
   cursor=end;
  }
 }
 cache.set(s,result);return result;
}
export function continuousObservation(s:Specification,positionM:number){
 // Material coordinates: changing feed speed changes duration, never defect location.
 const t=positionM/Number(s.speed_m_min)*60000,segments=profileSegments(s);
 let low=0,high=segments.length;
 while(low<high){const mid=(low+high)>>>1;if(segments[mid].end_ms<=t)low=mid+1;else high=mid;}
 const event=segments[low],inside=!!event&&t>=event.start_ms&&t<event.end_ms;
 let envelope=0;
 if(inside){const u=(t-event.start_ms)/(event.end_ms-event.start_ms),edge=Math.min(u,1-u)/event.ramp;envelope=edge>=1?1:(1-Math.cos(Math.PI*Math.max(0,edge)))/2;}
 if(s.algorithm==='seeded-perimeter.v4'){
  const noise=s.noise_pct/100,period=2500+4500*random(s.seed,0,20),phase=2*Math.PI*random(s.seed,0,21);
  const normal=noise*(0.55*smooth(s.seed,t,5000,1)+0.15*Math.sin(2*Math.PI*t/period+phase)+0.25*smooth(s.seed,t,800,2)+0.05*smooth(s.seed,t,80,12));
  const direction=inside?(random(s.seed,low,104)<0.5?-1:1):0;
  const shape=normal+direction*s.anomaly_pct/100*(inside?event.strength:0)*envelope;
  const axes=fixedPerimeterAxes(Number(s.inputs.diameter_x_mm),shape);
  return {diameter_x_mm:axes.x,diameter_y_mm:axes.y,b_x_mm:s.inputs.b_x_mm,b_y_mm:s.inputs.b_y_mm||undefined,injected:inside&&envelope>0,clipped:axes.limited,perimeter_mm:axes.actual,perimeter_error_mm:axes.error};
 }
 const noise=s.noise_pct/100;
 const period=2500+4500*random(s.seed,0,20),phase=2*Math.PI*random(s.seed,0,21);
 const common=noise*(0.50*smooth(s.seed,t,5000,1)+0.15*Math.sin(2*Math.PI*t/period+phase));
 const axis=(channel:number)=>noise*(0.25*smooth(s.seed,t,800,channel)+0.10*smooth(s.seed,t,80,channel+10));
 let x=Number(s.inputs.diameter_x_mm)*(1+common+axis(2)),y=Number(s.inputs.diameter_y_mm)*(1+common+axis(3));
 const stretch=1+s.anomaly_pct/100*(inside?event.strength:0)*envelope;
 // Choose a stable direction from the baseline. No axis-switch discontinuities.
 if(Number(s.inputs.diameter_x_mm)>=Number(s.inputs.diameter_y_mm)){x*=stretch;y/=stretch;}else{y*=stretch;x/=stretch;}
 let clipped=false;
 const diameter=(v:number)=>{if(v<0.01||v>655.35)clipped=true;return Math.max(0.01,Math.min(655.35,v)).toFixed(6);};
 const diameter_x_mm=diameter(x),diameter_y_mm=diameter(y);
 const b_x_mm=diameter(Number(s.inputs.b_x_mm)*(1+common+axis(4)));
 const b_y_mm=s.inputs.b_y_mm===''?undefined:diameter(Number(s.inputs.b_y_mm)*(1+common+axis(5)));
 return {diameter_x_mm,diameter_y_mm,b_x_mm,b_y_mm,injected:inside&&envelope>0,clipped};
}
