import Ajv from 'ajv/dist/2020';
import formats from 'ajv-formats';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ApiError} from './errors';
const schema=JSON.parse(readFileSync(resolve(process.env.CONTRACT_ROOT||'../../contracts','devices/v1/device-ingestion.schema.json'),'utf8'));
const ajv=new Ajv({allErrors:true,strict:false});formats(ajv);ajv.addSchema(schema);
const cache=new Map<string,ReturnType<typeof ajv.compile>>();
export function validate(name:string,value:unknown){
 let fn=cache.get(name);if(!fn){fn=ajv.compile({$ref:schema.$id+'#/$defs/'+name});cache.set(name,fn);}
 if(!fn(value))throw new ApiError(400,'RECORD_INVALID','字段格式不符合接入契约',(fn.errors||[]).map(e=>({path:e.instancePath,code:e.keyword,message:e.message||'格式错误'})));
}
// Scan the JSON text before JSON.parse: a reviver cannot detect duplicate keys.
export function parseJson(raw:string):any{
 let p=0;const ws=()=>{while(/\s/.test(raw[p]||'x'))p++;};
 const string=()=>{const start=p++;while(p<raw.length){if(raw[p]==='\\'){p+=2;continue;}if(raw[p++]==='"'){const v=JSON.parse(raw.slice(start,p));for(let i=0;i<v.length;i++){const c=v.charCodeAt(i);if(c>=0xd800&&c<=0xdbff){const n=v.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))throw Error('Unicode');}else if(c>=0xdc00&&c<=0xdfff)throw Error('Unicode');}return v;}}throw Error('string');};
 const walk=(depth=0):void=>{if(depth>32)throw Error('depth');ws();const c=raw[p];if(c==='"'){string();return;}if(c==='{'||c==='['){const obj=c==='{',end=obj?'}':']',seen=new Set();p++;ws();if(raw[p]===end){p++;return;}while(p<raw.length){ws();if(obj){if(raw[p]!=='"')throw Error('key');const k=string();if(seen.has(k))throw Error('duplicate');seen.add(k);ws();if(raw[p++]!==':')throw Error('colon');}walk(depth+1);ws();if(raw[p]===end){p++;return;}if(raw[p++]!==',')throw Error('comma');}throw Error('end');}const m=raw.slice(p).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)throw Error('value');if(!['true','false','null'].includes(m[0])&&!Number.isFinite(Number(m[0])))throw Error('number');p+=m[0].length;};
 try{walk();ws();if(p!==raw.length)throw Error('trailing');return JSON.parse(raw);}catch{throw new ApiError(400,'REQUEST_INVALID','JSON语法、重复字段、Unicode或嵌套深度不合法');}
}
