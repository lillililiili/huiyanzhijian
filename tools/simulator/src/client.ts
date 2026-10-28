import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import Ajv from 'ajv/dist/2020';
import formats from 'ajv-formats';
import {createHash} from 'node:crypto';
const contractPaths = [
 process.env.CONTRACT_ROOT ? resolve(process.env.CONTRACT_ROOT, 'devices/v1/device-ingestion.schema.json') : '',
 resolve('contracts/devices/v1/device-ingestion.schema.json'),
 resolve('../../contracts/devices/v1/device-ingestion.schema.json'),
].filter(Boolean);
let schemaPath = contractPaths.find(p => existsSync(p)) || resolve('contracts/devices/v1/device-ingestion.schema.json');
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv=new Ajv({strict:false,allErrors:true});formats(ajv);ajv.addSchema(schema);
export function check(name:string,value:unknown){const fn=ajv.getSchema(schema.$id+'#/$defs/'+name)||ajv.compile({$ref:schema.$id+'#/$defs/'+name});if(!fn(value))throw Error('Invalid '+name+' response; queue retained');}
export function verifyAssignment(a:any){
 const normalize=(v:any,key=''):any=>{if(typeof v==='string'&&['lower','upper'].includes(key))return v.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'').replace(/^-0$/,'0');if(Array.isArray(v))return v.map(x=>normalize(x));if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k],k)]));return v;};
 const {snapshot_hash,...body}=a;if(createHash('sha256').update(JSON.stringify(normalize(body))).digest('hex')!==snapshot_hash)throw Error('Assignment digest mismatch; no capture started');
}
export class HttpFailure extends Error{constructor(public status:number,public retryMs:number){super('HTTP '+status);}}
export class DeviceClient{
 constructor(private url:string,private token:string){const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid API URL');}
 async catalog(params:Record<string,string>){
  const r=await fetch(this.url+'/api/v1/simulator/catalog?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+this.token},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!r.ok)throw new HttpFailure(r.status,0);const b=await r.json() as any;
  if(b.code!=='OK'||!b.data||!Array.isArray(b.data.items)||!Array.isArray(b.data.devices)||!Number.isInteger(b.data.total)||typeof b.data.factory_id!=='string')throw Error('Invalid simulator catalog response');return b.data;
 }
 async productionRequest(payload:unknown){
  const r=await fetch(this.url+'/api/v1/production-events',{method:'POST',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(5000),redirect:'error'});const value=await r.json();return {status:r.status,value};
 }
 async sendCutSpoolEvent(payload:{device_id:string;spool_id?:string|null;position_m:string;event_type?:string}){
  const event={
   event_type:'CUT_SPOOL',
   device_id:payload.device_id,
   spool_id:payload.spool_id||undefined,
   position_m:payload.position_m,
   occurred_at:new Date().toISOString(),
  };
  return this.productionRequest(event);
 }
 async request(path:string,definition:string,payload?:unknown){const r=await fetch(this.url+'/api/v1'+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+this.token,...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok){const retry=Number(r.headers.get('retry-after')||0)*1000;throw new HttpFailure(r.status,Number.isFinite(retry)?retry:0);}const b=await r.json();check(definition,b);return b;}
}
