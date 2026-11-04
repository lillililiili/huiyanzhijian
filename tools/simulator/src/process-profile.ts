import type {Specification} from './specification';
import {profileSegments,random,smooth} from './continuous-profile';
import {fixedPerimeterAxes} from './ellipse-perimeter';
// Synthetic process scenario; amplitudes are scenario parameters, not measured tolerances.
export function processPoint(s:Specification,index:number,positionM?:number){
 const dt=s.sampling_interval_ms!,speed=Number(s.speed_m_min),p=s.process!;
 const position=positionM??index*dt*speed/60000,t=position/speed*60000;
 const segments=profileSegments(s);let lo=0,hi=segments.length;
 while(lo<hi){const mid=(lo+hi)>>>1;if(segments[mid].end_ms<=t)lo=mid+1;else hi=mid;}
 const e=segments[lo],inside=!!e&&t>=e.start_ms&&t<e.end_ms;
 const u=inside?(t-e.start_ms)/(e.end_ms-e.start_ms):0;
 const edge=inside?Math.min(u,1-u)/e.ramp:0;
 const envelope=inside?(edge>=1?1:(1-Math.cos(Math.PI*edge))/2):0;
 // Preserve material positions through speed changes. Different diameter/pitch changes spatial scale.
 const scale=Math.max(.05,p.diameter_mm/1000*20),phase=random(s.seed,0,30)*Math.PI*2;
 const pitch=p.pitch_mm/1000,window=speed*dt/60000;
 const sinc=Math.abs(Math.sin(Math.PI*window/pitch)/(Math.PI*window/pitch));
 const periodic=sinc*Math.sin(position/pitch*2*Math.PI+phase);
 const start=Math.exp(-position/(scale*2))*Math.sin(position/scale*4+phase);
 const normal=.45*smooth(s.seed,position,scale,31)+.25*smooth(s.seed,position,scale*.2,32)+.2*periodic+.1*start;
 const event=(inside?e.strength:0)*envelope*(.9+.1*smooth(s.seed,position,scale*.1,33));
 const g={tape_width_mm:'20',overlap_width_mm:'2.5',wire_gap_mm:'1.25',diameter_x_mm:'40',diameter_y_mm:'40',...Object.fromEntries(Object.entries(s.inputs).filter(([k])=>!['b_x_mm','b_y_mm','meter_delay_ms'].includes(k)))};
 let clipped=false;const value=(n:number,min=0,max=1000)=>{if(n<min||n>max)clipped=true;return Math.max(min,Math.min(max,n)).toFixed(6);};
 let bx:string|undefined,by:string|undefined,perimeter:number|undefined,perimeterError:number|undefined;
 const drift=s.noise_pct/100*normal,defect=s.anomaly_pct/100*event;
 if(s.metric==='SHIELD_OVERLAP_RATE')g.overlap_width_mm=value(Number(s.inputs.overlap_width_mm)*(1+drift-defect),0,Number(g.tape_width_mm));
 if(s.metric==='WIRE_GAP')g.wire_gap_mm=value(Number(s.inputs.wire_gap_mm)*(1+drift+defect));
 if(s.metric==='OVALITY'){
  const direction=random(s.seed,lo,44)<.5?-1:1,axes=fixedPerimeterAxes(Number(s.inputs.diameter_x_mm),drift+direction*defect);
  g.diameter_x_mm=axes.x;g.diameter_y_mm=axes.y;clipped=axes.limited;perimeter=axes.actual;perimeterError=axes.error;
  const baselineB=s.inputs.b_y_mm?(Number(s.inputs.b_x_mm)+Number(s.inputs.b_y_mm))/2:Number(s.inputs.b_x_mm);
  const thickness=Number(s.inputs.diameter_x_mm)-baselineB;
  // A keeps the approved fixed perimeter. B varies within that geometry; do not randomize derived thickness independently.
  const shift=thickness*(p.sheath_pct/100*event*(random(s.seed,lo,45)<.5?-1:1)+s.noise_pct/100*smooth(s.seed,position,scale*2,46));
  const cap=Math.max(.01,Math.min(Number(axes.x),Number(axes.y))-.000001);
  bx=value(Number(s.inputs.b_x_mm)+shift,.01,cap);
  if(s.inputs.b_y_mm)by=value(Number(s.inputs.b_y_mm)+shift,.01,cap);
 }
 const x=Number(g.diameter_x_mm),y=Number(g.diameter_y_mm);
 return {index,elapsed_ms:index*dt,position_m:position.toFixed(6),injected:inside&&envelope>0,clipped,geometry:g,b_x_mm:bx,b_y_mm:by,meter_delay_ms:s.inputs.meter_delay_ms,
 metric_value:s.metric==='OVALITY'?Math.min(x,y)/Math.max(x,y):s.metric==='WIRE_GAP'?Number(g.wire_gap_mm):100*Number(g.overlap_width_mm)/Number(g.tape_width_mm),
 sheath_mm:bx===undefined?null:(x+y)/2-(by===undefined?Number(bx):(Number(bx)+Number(by))/2),perimeter_mm:perimeter,perimeter_error_mm:perimeterError};
}
