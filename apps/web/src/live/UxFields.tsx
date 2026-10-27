import {useState,type ReactNode} from 'react';
import {Field} from '../ui/Field';

// Preserve the original query string until the user changes the picker, including microseconds.
export function localDateInput(raw:string){const date=new Date(raw);return Number.isNaN(date.valueOf())?'':new Date(date.valueOf()+8*3600000).toISOString().slice(0,-1);}
export function DateTimeField({name,label,value}:{name:string;label:string;value:string|null}){
 const [raw,setRaw]=useState(value||'');
 return <Field label={label+'（北京时间 UTC+08:00）'}><input type="hidden" name={name} value={raw}/><input type="datetime-local" step="0.001" value={raw?localDateInput(raw):''} title={raw||'北京时间'} onChange={e=>setRaw(e.target.value?e.target.value+'+08:00':'')}/>{raw&&!localDateInput(raw)&&<span role="alert">原时间条件无效，请重新选择：{raw}</span>}</Field>;
}
export function AdvancedFilters({children,params,keys}:{children:ReactNode;params:URLSearchParams;keys:string[]}){const count=keys.filter(k=>params.has(k)).length;return <details className="ux-advanced"><summary>高级筛选{count?`（已应用 ${count} 项）`:''}</summary><div className="filters">{children}</div></details>;}
export function ScopedOptions({options,selected}:{options:{id:string;label:string}[];selected:string|null}){return <>{selected&&!options.some(o=>o.id===selected)&&<option value={selected}>{selected}（原筛选不在当前适用范围）</option>}{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</>;}
