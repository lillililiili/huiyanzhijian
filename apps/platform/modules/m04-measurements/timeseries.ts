import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import Decimal from 'decimal.js';
import {ApiError} from '../../infrastructure/errors';
import {instantMicros} from '../../infrastructure/canonical';

export type SampleReference={storage:'INFLUXDB';version:'ts01.1';point_id:string;content_hash:string};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const unavailable=()=>new ApiError(503,'TIMESERIES_UNAVAILABLE','不圆度历史采样存储不可用或数据校验失败，请稍后重试',[],'UNKNOWN');
export function isSampleReference(v:any):v is SampleReference{return v?.storage==='INFLUXDB'&&v?.version==='ts01.1';}
function configuration(){
 let token=process.env.OVALITY_INFLUX_TOKEN;
 if(!token&&process.env.OVALITY_INFLUX_TOKEN_FILE)try{token=readFileSync(process.env.OVALITY_INFLUX_TOKEN_FILE,'utf8').trim();}catch{throw unavailable();}
 const base=process.env.OVALITY_INFLUX_URL,org=process.env.OVALITY_INFLUX_ORG,bucket=process.env.OVALITY_INFLUX_BUCKET;
 if(!base||!org||!bucket||!token)throw unavailable();
 const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw unavailable();
 return {base:base.replace(/\/$/,''),org,bucket,token};
}
async function request(path:string,body:string,type:string){
 const c=configuration();
 try{
  const res=await fetch(c.base+path,{method:'POST',headers:{Authorization:`Token ${c.token}`,'Content-Type':type,Accept:'text/csv'},body,signal:AbortSignal.timeout(8000),redirect:'error'});
  if(!res.ok)throw unavailable();
  // Bound the response before parsing; never include credentials/server bodies in errors.
  const reader=res.body?.getReader(),parts:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16*1024*1024){await reader.cancel();throw unavailable();}parts.push(value);}
  return {status:res.status,text:Buffer.concat(parts).toString('utf8')};
 }catch{throw unavailable();}
}
// RFC4180 including quoted commas, quotes, CRLF and newlines in string fields.
export function parseCsv(s:string){const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;for(let i=0;i<s.length;i++){const ch=s[i];if(ch==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if(ch==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=ch;}if(quoted)throw unavailable();if(cell||row.length){row.push(cell);rows.push(row);}return rows;}

export class OvalityTimeseries {
 async health(){try{const c=configuration();await request('/api/v2/query?org='+encodeURIComponent(c.org),JSON.stringify({query:`from(bucket: ${JSON.stringify(c.bucket)}) |> range(start: -1ns) |> limit(n: 1)`,type:'flux',dialect:{annotations:[]}}),'application/json');return 'UP';}catch{return 'DOWN';}}
 async write(factory:string,device:string,sourceKey:string,payloadHash:string,raw:any,value:string|number|null):Promise<SampleReference>{
  const c=configuration();
  let micros:bigint;try{micros=instantMicros(raw.sample_time);}catch{throw new ApiError(400,'SAMPLE_TIME_UNSUPPORTED','采样时间不受时序存储支持');}
  const ns=micros*1000n;if(ns<=-9223372036854775806n||ns>=9223372036854775806n)throw new ApiError(400,'SAMPLE_TIME_UNSUPPORTED','采样时间不受时序存储支持');
  const contents=JSON.stringify({raw_payload:raw,value:value===null?null:new Decimal(value).toFixed(10)});
  // Hash-derived tag IDs cannot inject line protocol or Flux. Same timestamp is
  // not identity: two samples at exactly the same instant remain distinct.
  const point=hash(JSON.stringify([factory,device,sourceKey,payloadHash]));
  const reference:SampleReference={storage:'INFLUXDB',version:'ts01.1',point_id:point,content_hash:hash(contents)};
  const line=`ovality_sample,factory=${hash(factory)},point=${point} payload="${Buffer.from(contents).toString('base64')}" ${ns}\n`;
  const result=await request(`/api/v2/write?org=${encodeURIComponent(c.org)}&bucket=${encodeURIComponent(c.bucket)}&precision=ns`,line,'text/plain');
  if(result.status!==204)throw unavailable();
  return reference;
 }
 async read(factory:string,refs:SampleReference[]){
  const out=new Map<string,{raw_payload:any;value:string|null}>();if(!refs.length)return out;
  const c=configuration();const unique=[...new Map(refs.map(r=>[r.point_id,r])).values()];
  for(let i=0;i<unique.length;i+=50){
   const group=unique.slice(i,i+50);
   if(group.some(r=>!/^\w{64}$/.test(r.point_id)||!/^[a-f0-9]{64}$/.test(r.content_hash)))throw unavailable();
   const condition=group.map(r=>`r.point == "${r.point_id}"`).join(' or ');
   const query=`from(bucket: ${JSON.stringify(c.bucket)}) |> range(start: time(v: -9223372036854775806), stop: time(v: 9223372036854775806)) |> filter(fn: (r) => r._measurement == "ovality_sample" and r._field == "payload" and r.factory == "${hash(factory)}" and (${condition})) |> keep(columns: ["point", "_value"])`;
   const response=await request('/api/v2/query?org='+encodeURIComponent(c.org),JSON.stringify({query,type:'flux',dialect:{annotations:[]}}),'application/json');
   let header:string[]=[];
   for(const row of parseCsv(response.text)){
    if(row.includes('_value')&&row.includes('point')){header=row;continue;}if(!header.length||row.length!==header.length)continue;
    const id=row[header.indexOf('point')],ref=group.find(r=>r.point_id===id);if(!ref)continue;
    const contents=Buffer.from(row[header.indexOf('_value')],'base64').toString('utf8');if(hash(contents)!==ref.content_hash||out.has(id))throw unavailable();
    try{const data=JSON.parse(contents);if(!data.raw_payload||!Object.hasOwn(data,'value'))throw unavailable();out.set(id,data);}catch{throw unavailable();}
   }
   if(group.some(r=>!out.has(r.point_id)))throw unavailable();
  }return out;
 }
}
export const ovalityTimeseries=new OvalityTimeseries();
