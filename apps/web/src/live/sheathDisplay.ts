import type {Measurement} from './api';

export function sheathAvailable(row:Measurement){
  const r=row.sheath_result;
  return r?.status==='VERIFIED' && r.unit==='mm' && typeof r.value==='string' && /^-?\d+(\.\d+)?$/.test(r.value) && Number.isFinite(Number(r.value)) && row.receipt_status==='STORED' && row.raw_payload.data_status==='VALID';
}
export function sheathStatus(row:Measurement){
  if(row.receipt_status!=='STORED')return '隔离记录';
  if(row.raw_payload.data_status!=='VALID')return '采样无效 / 缺测';
  if(sheathAvailable(row))return '配对核对通过';
  return ({INVALID:'配对校验失败',UNAVAILABLE:'未完成配对',NOT_PROVIDED:'未携带配对'} as Record<string,string>)[row.sheath_result?.status||'NOT_PROVIDED']||'结果不可用';
}
// Projection for the shared chart only; original rows remain unchanged for trace/export.
export function sheathChartRows(rows:Measurement[]):Measurement[]{
  return rows.map(row=>({...row,value:sheathAvailable(row)?row.sheath_result!.value:null,unit:'mm',quality_result:'NOT_EVALUATED',evaluation_reason:'未配置护套质量限值',raw_payload:{...row.raw_payload,data_status:sheathAvailable(row)?'VALID':'MISSING'}}));
}
