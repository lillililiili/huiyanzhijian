// Cable truth has no transport, platform credentials, detector limits or quality verdicts.
export const metrics=['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'] as const;
export type Metric=typeof metrics[number];
export type Geometry={tape_width_mm:string;overlap_width_mm:string;wire_gap_mm:string;diameter_x_mm:string;diameter_y_mm:string};
export type Defect={name:string;metric:Metric;start_m:string;length_m:string;value_mm:string;profile?:{kind:"SMOOTH";seed:string;ripple_pct:string}};
export type Cable={name:string;material_ref:string;length_m:string;baseline:Geometry;defects:Defect[]};
export class ModelError extends Error{constructor(public status:number,public code:string,message:string){super(message);}}
export function insist(ok:unknown,message:string,status=400,code='MODEL_INVALID'):asserts ok{if(!ok)throw new ModelError(status,code,message);}
export function fixed(v:unknown,max=1000000):bigint{insist(typeof v==='string'&&/^\d{1,7}(\.\d{1,6})?$/.test(v),'请输入非负十进制字符串，最多6位小数');const [a,b='']=v.split('.');const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));insist(n<=BigInt(max)*1000000n,'数值超出测试范围');return n;}
export function decimal(v:bigint){return (v/1000000n)+'.'+String(v%1000000n).padStart(6,'0');}
export function keys(v:any,allowed:string[]){insist(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===allowed.length&&Object.keys(v).every(k=>allowed.includes(k)),'字段缺失或存在未知字段');}
export function named(v:unknown,max=128){insist(typeof v==='string'&&v.trim().length>0&&v.length<=max,'名称/原因必填且不能超长');}
export function validateCable(c:Cable){
 keys(c,['name','material_ref','length_m','baseline','defects']);named(c.name);named(c.material_ref);const length=fixed(c.length_m);insist(length>0n,'线缆长度必须大于0');
 const baseKeys=['tape_width_mm','overlap_width_mm','wire_gap_mm','diameter_x_mm','diameter_y_mm'];
 insist(c.baseline&&typeof c.baseline==='object'&&!Array.isArray(c.baseline)&&baseKeys.every(k=>k in c.baseline)&&Object.keys(c.baseline).length===baseKeys.length,'线缆基准量字段缺失或存在未知字段');
 for(const [k,v] of Object.entries(c.baseline)){const n=fixed(v,1000);insist(n>0n||k==='wire_gap_mm'||k==='overlap_width_mm','宽度和直径必须大于0');}
 insist(fixed(c.baseline.overlap_width_mm)<=fixed(c.baseline.tape_width_mm),'搭盖宽度不能超过带宽');
 insist(Array.isArray(c.defects)&&c.defects.length<=20,'每版最多20个缺陷区段');
 for(const d of c.defects){keys(d,['name','metric','start_m','length_m','value_mm',...(d.profile?['profile']:[])]);if(d.profile){keys(d.profile,['kind','seed','ripple_pct']);insist(d.profile.kind==='SMOOTH','波动类型无效');insist(/^\d{1,9}$/.test(d.profile.seed),'波动种子无效');insist(fixed(d.profile.ripple_pct,20)>=0n,'波动幅度无效');}named(d.name);insist(metrics.includes(d.metric),'不支持的检测项');const start=fixed(d.start_m),size=fixed(d.length_m);insist(size>0n&&start+size<=length,'缺陷区段必须位于线缆内且长度大于0');const value=fixed(d.value_mm,1000);if(d.metric==='SHIELD_OVERLAP_RATE')insist(value<=fixed(c.baseline.tape_width_mm),'异常搭盖宽度不能超过带宽');if(d.metric==='OVALITY')insist(value>0n,'异常Y向直径必须大于0');}
 for(let i=0;i<c.defects.length;i++)for(let j=0;j<i;j++){const a=c.defects[i],b=c.defects[j];insist(a.metric!==b.metric||fixed(a.start_m)>=fixed(b.start_m)+fixed(b.length_m)||fixed(b.start_m)>=fixed(a.start_m)+fixed(a.length_m),'同检测项的缺陷区段不得重叠');}
 return c;
}
// Exposes only the local physical observation. Defect names/ranges never cross this boundary.
export function observeCable(c:Cable,position:bigint):Geometry{
 insist(position>=0n&&position<=fixed(c.length_m),'采样位置超出线缆');const g={...c.baseline};
 for(const d of c.defects)if(position>=fixed(d.start_m)&&position<fixed(d.start_m)+fixed(d.length_m)){
  const field=d.metric==='SHIELD_OVERLAP_RATE'?'overlap_width_mm':d.metric==='WIRE_GAP'?'wire_gap_mm':'diameter_y_mm';
  if(!d.profile)g[field]=d.value_mm;
  else {
   const t=Number(position-fixed(d.start_m))/Number(fixed(d.length_m));
   const envelope=Math.sin(Math.PI*t)**2;
   const ripple=1-Number(d.profile.ripple_pct)/100*(1+Math.sin(t*6*Math.PI+Number(d.profile.seed)))/2;
   g[field]=(Number(c.baseline[field])+(Number(d.value_mm)-Number(c.baseline[field]))*envelope*ripple).toFixed(6);
  }
 }
 return g;
}
