import {requireValue,textField} from './errors';
import {instantMicros} from './canonical';
export function pageQuery(q:Record<string,any>,allowed:string[]){
 for(const [k,v] of Object.entries(q))requireValue(['page','limit',...allowed].includes(k)&&typeof v==='string','VALIDATION_FAILED','查询字段不支持');
 const page=Number(q.page||1),limit=Number(q.limit||20);requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000&&Number.isInteger(limit)&&limit>0&&limit<=100);
 for(const k of allowed)if(q[k])textField(q[k],128);
 for(const k of ['from','to'])if(q[k]){requireValue(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/.test(q[k])&&Number.isFinite(Date.parse(q[k])),'VALIDATION_FAILED','时间必须包含时区');const [year,month,day]=q[k].slice(0,10).split('-').map(Number);requireValue(year>=1900&&month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate(),'VALIDATION_FAILED','日期不存在');}
 if(q.from&&q.to)requireValue(instantMicros(q.from)<instantMicros(q.to),'VALIDATION_FAILED','时间起点必须早于终点');
 return {page,limit};
}
export function redact(v:any):any{if(Array.isArray(v))return v.map(redact);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/password|secret|token|cookie|credential|raw_payload|authorization|csrf/i.test(k)?'[REDACTED]':redact(x)]));return v;}

