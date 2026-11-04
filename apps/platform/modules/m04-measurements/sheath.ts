import Decimal from 'decimal.js';
import {instantMicros} from '../../infrastructure/canonical';

/** Derived read model: original edge evidence stays immutable in central TS. */
export function verifySheath(raw:any){
 const d=raw?.raw?.data,p=d?.edge_sheath;
 const result={status:'NOT_PROVIDED',value:null as string|null,unit:'mm',method:'sheath-a-mean-minus-b-mean.meter-time.v3',validation_version:'SC01.v1',reason:'本条记录未携带边缘护套配对结果',pair:p??null};
 if(!p)return result;
 result.status='UNAVAILABLE';result.reason='边缘未完成配对：'+String(p.status);
 if(p.status!=='TIME_COMPENSATED')return result;
 result.status='INVALID';result.reason='配对原始值、时间或配置不一致';
 try{
  const n=(v:unknown)=>{if(typeof v==='number'&&Number.isSafeInteger(v))v=String(v);if(typeof v!=='string'||! /^-?\d+(\.\d+)?$/.test(v))throw Error();const x=new Decimal(v);if(!x.isFinite())throw Error();return x;};
  const o=d.observation,m=d.edge_simulation?.meter,b=d.edge_simulation?.gauge_b;
  if(raw.data_status!=='VALID'||raw.data_environment!=='SIMULATED'||p.method!==result.method||!d.edge_gateway?.run_id||!m||!b||b.status!=='VALID'||p.meterSource!=='SIMULATED'||m.source!=='SIMULATED')return result;
  const x=n(o.diameter_x_mm),y=n(o.diameter_y_mm);if(x.lte(0)||y.lte(0))return result;
  if(!Array.isArray(b.values)||b.values.length<1||b.values.length>2)return result;
  const values=b.values.map(n);if(values.some((v:Decimal)=>v.lte(0)))return result;
  const a=x.plus(y).div(2),bm=values.reduce((sum:Decimal,v:Decimal)=>sum.plus(v),new Decimal(0)).div(values.length);
  const value=a.minus(bm),close=(l:Decimal,r:unknown)=>l.minus(n(r)).abs().lte('0.000000001');
  if(!close(a,p.aMean)||!close(bm,p.bMean)||!close(value,p.value))return result;
  const at=instantMicros(raw.sample_time),bt=instantMicros(b.sample_time),delay=n(m.delay_ms);
  if(!delay.isInteger()||delay.lt(0)||delay.gt(3600000)||at-bt!==BigInt(delay.toFixed(0))*1000n)return result;
  if(instantMicros(p.aAt)!==at||instantMicros(p.bAt)!==bt||instantMicros(p.targetAt)!==bt||instantMicros(m.sample_time)!==at)return result;
  if(!n(p.delayMs).eq(delay)||!n(p.distanceMm).eq(n(m.distance_mm))||n(p.distanceMm).lte(0)||p.syncRevision!==m.sync_revision||p.meterRecordId!==m.record_id||!p.meterRecordId||p.upstreamGauge!=='B'||!n(p.residualMs).eq(0))return result;
  return {...result,status:'VERIFIED',value:value.toFixed(10),reason:'中心已核对 A/B 原始尺寸与时间配对；未配置护套质量限值'};
 }catch{return result;}
}
