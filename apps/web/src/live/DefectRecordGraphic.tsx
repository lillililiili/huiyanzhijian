import {useId} from 'react';
import type {Measurement,Task} from './api';
import {compareDecimal,matchDefect} from './defectMatch';

type Geometry={kind:'overlap';width:string;overlap:string}|{kind:'gap';gap:string}|{kind:'ovality';x:string;y:string};
export function exactDistance(a:string,b:string){
 const scale=Math.max(a.split('.')[1]?.length||0,b.split('.')[1]?.length||0);
 const fixed=(s:string)=>{const [i,f='']=s.replace(/^[-+]/,'').split('.');return (s.startsWith('-')?-1n:1n)*BigInt(i+f.padEnd(scale,'0'));};
 const delta=fixed(a)-fixed(b),digits=(delta<0n?-delta:delta).toString().padStart(scale+1,'0');
 return scale?(digits.slice(0,-scale)+'.'+digits.slice(-scale)).replace(/\.?0+$/,'')||'0':digits;
}
export function recordGraphic(record:Measurement,task?:Task){
 const matched=matchDefect(record,task);if(!matched.direction||!task)return {reason:matched.reason};
 const boundary=(matched.direction==='LOW'?task.rule_snapshot.comparison?.lower:task.rule_snapshot.comparison?.upper)!;
 if(compareDecimal(record.value,boundary)===null)return {reason:'检测值或界限无效，不能绘图。'};
 const value=record.value!,raw=(record.raw_payload as typeof record.raw_payload&{raw?:{data?:Record<string,unknown>}}).raw?.data;
 let geometry:Geometry|undefined,geometryReason='本条只有检测数值，未提供局部尺寸或照片；不推断线缆实际外观。';
 if(raw?.simulation_model==='SIM02'&&record.raw_payload.data_environment==='SIMULATED'){
  const o=raw.observation as Record<string,unknown>|undefined;
  const number=(k:string)=>{const v=o?.[k];return typeof v==='string'&&/^\d{1,7}(\.\d{1,10})?$/.test(v)&&Number(v)<=1000?v:undefined;};
  const w=number('tape_width_mm'),a=number('overlap_width_mm'),gap=number('wire_gap_mm'),x=number('diameter_x_mm'),y=number('diameter_y_mm');
  let derived:number|undefined;
  if(record.metric_code==='SHIELD_OVERLAP_RATE'&&raw.algorithm==='sim-overlap-width-ratio.v1'&&w&&Number(w)>0&&a!==undefined&&Number(a)<=Number(w)){
   geometry={kind:'overlap',width:w,overlap:a};derived=100*Number(a)/Number(w);
  }else if(record.metric_code==='WIRE_GAP'&&raw.algorithm==='sim-wire-gap-direct.v1'&&gap!==undefined){geometry={kind:'gap',gap};derived=Number(gap);}
  else if(record.metric_code==='OVALITY'&&raw.algorithm==='sim-legacy-percent-mean.v1'&&x&&y&&Number(x)>0&&Number(y)>0){geometry={kind:'ovality',x,y};derived=200*Math.abs(Number(x)-Number(y))/(Number(x)+Number(y));}
  geometryReason='本条原始尺寸缺失或算法不支持，未生成线缆形态图。';
  if(geometry&&derived!==undefined&&compareDecimal(derived.toFixed(10),value)!==0){geometry=undefined;geometryReason='原始尺寸计算值与本条检测值冲突，未生成线缆形态图。';}
  if(geometry)geometryReason='按本条SIM02原始观测尺寸绘制；非相机照片。';
 }
 return {name:matched.name,direction:matched.direction,value,boundary,delta:exactDistance(value,boundary),unit:record.unit,geometry,geometryReason};
}

export function DefectRecordGraphic({record,task}:{record:Measurement;task?:Task}){
 const data=recordGraphic(record,task),uid=useId().replace(/:/g,'');
 if(!data.value)return <p role="status">{data.reason}</p>;
 const {value,boundary,unit,geometry:g}=data,v=Number(value),b=Number(boundary),lo=Math.min(0,v,b),hi=Math.max(0,v,b),span=Math.max(hi-lo,0.0000000001),px=(n:number)=>65+(n-lo)/span*570;
 const color='#e8ad66',red='#ff6666',grey='#c5cbd3',yellow='#ffe27a';
 const distanceUnit=unit==='%'?'个百分点':unit;
 const deltaLabel=`${data.direction==='LOW'?'低于下限':'高于上限'} ${data.delta} ${distanceUnit}`;
 const tick=(x1:number,y1:number,x2:number,y2:number,label:string)=><g stroke={yellow} fill={yellow}><line x1={x1} y1={y1} x2={x2} y2={y2}/><circle cx={x1} cy={y1} r="2"/><circle cx={x2} cy={y2} r="2"/><text stroke="none" x={(x1+x2)/2} y={(y1+y2)/2-9} textAnchor="middle" fontSize="15">{label}</text></g>;
 return <figure className="record-graphic" data-record-id={record.id} data-value={value}>
  <svg viewBox={`0 0 720 ${g?530:240}`} role="img" aria-label={`${data.name}，检测值${value}${unit}，${deltaLabel}，按本条记录绘图`}>
   <defs><linearGradient id={uid+'metal'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#66442e"/><stop offset="0.45" stopColor="#efc28d"/><stop offset="0.65" stopColor="#9c6c47"/><stop offset="1" stopColor="#543923"/></linearGradient></defs>
   <rect width="720" height={g?530:240} rx="8" fill="#101820"/>
   <text x="28" y="33" fill="white" fontSize="19" fontWeight="600">{data.name} · 本条异常对照</text>
   <text x="28" y="61" fill={red} fontSize="15">{deltaLabel}</text>
   <text x="65" y="96" fill={grey} fontSize="15">规则{data.direction==='LOW'?'下限':'上限'}：{boundary} {unit}</text>
   <rect x={Math.min(px(0),px(b))} y="108" width={Math.max(1,Math.abs(px(b)-px(0)))} height="17" fill="#758394"/>
   <line x1={px(b)} x2={px(b)} y1="102" y2="186" stroke={yellow} strokeDasharray="4 4"/>
   <text x="65" y="151" fill="white" fontSize="16">本条测量：{value} {unit}</text>
   <rect x={Math.min(px(0),px(v))} y="165" width={Math.max(0.2,Math.abs(px(v)-px(0)))} height="17" fill={red}/>
   <text x="65" y="212" fill={grey} fontSize="13">两条使用同一数值比例；小于显示像素的差异以精确数值为准。</text>
   {g&&<><line x1="28" x2="692" y1="238" y2="238" stroke="#3d4d5d"/><text x="28" y="268" fill="white" fontSize="17">本条局部观测尺寸</text>
    {g.kind==='overlap'&&(()=>{const width=360,a=width*Number(g.overlap)/Number(g.width);return <g>
     <rect x="65" y="318" width={width} height="75" fill={'url(#'+uid+'metal)'}/><rect x={425-a} y="342" width={width} height="75" fill={'url(#'+uid+'metal)'}/>
     <rect x={425-a} y="318" width={a} height="99" fill={red} fillOpacity="0.3" stroke={red}/>
     {tick(65,306,425,306,`铜带宽 ${g.width} mm`)}{tick(425-a,442,425,442,`搭盖宽 ${g.overlap} mm`)}
     <text x="65" y="482" fill={grey} fontSize="13">平面展开，右侧铜带截取显示；搭盖比例对应原始宽度，纵向长度未知。</text>
    </g>;})()}
    {g.kind==='gap'&&(()=>{const scale=Math.min(40,240/Math.max(Number(g.gap),6)),gap=Number(g.gap)*scale;return <g>
     <rect x={310-gap/2} y="291" width="50" height="140" fill={'url(#'+uid+'metal)'}/><rect x={360+gap/2} y="291" width="50" height="140" fill={'url(#'+uid+'metal)'}/>
     <rect x={360-gap/2} y="312" width={gap} height="106" fill={red} fillOpacity="0.1" stroke={red}/>{tick(360-gap/2,440,360+gap/2,440,`边缘间距 ${g.gap} mm`)}
     <text x="65" y="482" fill={grey} fontSize="13">铜丝沿上下方向连续，宽度仅示意；横向标实测间隙，不表示断丝。</text>
    </g>;})()}
    {g.kind==='ovality'&&(()=>{const scale=90/Math.max(Number(g.x),Number(g.y)),rx=Number(g.x)*scale,ry=Number(g.y)*scale;return <g>
     <ellipse cx="360" cy="376" rx={rx} ry={ry} fill="#24303d" stroke={color} strokeWidth="2"/>

     <rect x={360-rx-5} y={376-ry-5} width={rx*2+10} height={ry*2+10} fill="none" stroke={red}/>
     {tick(360-rx,376,360+rx,376,`X ${g.x} mm`)}
     <line x1="360" x2="360" y1={376-ry} y2={376+ry} stroke={yellow}/><text x={375+rx} y="382" fill={yellow} fontSize="15">Y {g.y} mm</text>


     <text x="65" y="482" fill={grey} fontSize="13">X/Y外径对应本条双向测径仪两点距离观测；按长轴与短轴计算不圆度。</text>
    </g>;})()}
   </>}
  </svg>
  <figcaption><strong>{data.geometryReason}</strong><span>单点测量 · 缺陷长度未提供</span></figcaption>
 </figure>;
}
