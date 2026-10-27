import { createHash } from 'node:crypto';
export function sha(value:string){return createHash('sha256').update(value).digest('hex');}
export function decimal(value:string){let s=value.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');if(/^-?0$/.test(s))s='0';return s;}
export function instant(value:string){
 const m=value.match(/^(.*T\d\d:\d\d:\d\d)(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/);if(!m)throw Error('timestamp');
 const base=new Date(m[1]+m[3]).toISOString().replace('.000Z','');return base+(m[2]?.replace(/0+$/,'').replace(/^\.$/,'')||'')+'Z';
}
export function instantMicros(value:string){const normalized=instant(value);const [base,frac='']=normalized.slice(0,-1).split('.');return BigInt(Date.parse(base+'Z'))*1000n+BigInt(frac.padEnd(6,'0')||'0');}
const decimalFields=new Set(['value','position_m','position_from_m','position_to_m','lower','upper']);
const timeFields=new Set(['sample_time','start','end','effective_at','occurred_at','captured_at']);
export function canonical(value:any,key='',inRaw=false):string{
 if(typeof value==='string')return JSON.stringify(inRaw?value:decimalFields.has(key)?decimal(value):timeFields.has(key)?instant(value):value);
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value)){const a=key==='evidence_refs'?[...value].sort():value;return '['+a.map(v=>canonical(v,'',inRaw)).join(',')+']';}
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],k,inRaw||key==='raw')).join(',')+'}';
}
export function digest(value:unknown){return sha(canonical(value));}
