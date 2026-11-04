import {useEffect,useId,useRef,useState} from 'react';
import {specificationLabel,type Specification} from './api';
import './specification-picker.css';

const alphabetic=new Intl.Collator('zh-CN-u-co-pinyin',{numeric:true,sensitivity:'base'});
export function SpecificationPicker({options,initial=[]}:{options:Specification[];initial?:string[]}){
 const [selected,setSelected]=useState(initial),[open,setOpen]=useState(false),[query,setQuery]=useState('');
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),search=useRef<HTMLInputElement>(null),id=useId();
 const sorted=[...options].sort((a,b)=>alphabetic.compare(a.code||a.name||a.id,b.code||b.name||b.id)||a.id.localeCompare(b.id));
 const chosen=sorted.filter(s=>selected.includes(s.id));
 const summary=chosen.length?`${chosen.slice(0,2).map(s=>s.code).join('、')}${chosen.length>2?' 等':''}（已选${chosen.length}项）`:'请选择产品规格（可多选）';
 const matches=sorted.filter(s=>`${s.code} ${s.name} ${specificationLabel(s)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 useEffect(()=>{if(open)search.current?.focus()},[open]);
 useEffect(()=>{const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',dismiss);return()=>document.removeEventListener('pointerdown',dismiss)},[]);
 return <div className="spec-picker" ref={root} onKeyDown={e=>{if(open&&e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus()}}}>
  <span id={id+'-label'} className="spec-picker-label">订单产品规格（可多选，至少一项）</span>
  {chosen.map(s=><input key={s.id} type="hidden" name="spec" value={s.id}/>)}
  <button ref={trigger} type="button" className="spec-picker-trigger" aria-labelledby={id+'-label '+id+'-value'} aria-expanded={open} aria-controls={id+'-options'} onClick={()=>setOpen(v=>!v)}><span id={id+'-value'} title={chosen.map(specificationLabel).join('；')}>{summary}</span><span aria-hidden="true">{open?'▴':'▾'}</span></button>
  {open&&<div className="spec-picker-dropdown" id={id+'-options'}>
   <input ref={search} type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label="搜索产品规格" placeholder="输入型号或规格搜索" onKeyDown={e=>{if(e.key==='Enter')e.preventDefault()}}/>
   <div className="spec-picker-options" role="group" aria-labelledby={id+'-label'}>{matches.map(s=><label key={s.id} className={selected.includes(s.id)?'selected':''}><input type="checkbox" checked={selected.includes(s.id)} onChange={()=>setSelected(ids=>ids.includes(s.id)?ids.filter(x=>x!==s.id):[...ids,s.id])}/><span>{specificationLabel(s)}</span></label>)}{!matches.length&&<p role="status">没有匹配的规格，请调整搜索内容。</p>}</div>
   <div className="spec-picker-footer"><span>按型号首字母排序 · 已选 {chosen.length} 项</span><button type="button" className="btn" onClick={()=>{setOpen(false);trigger.current?.focus()}}>完成选择</button></div>
  </div>}
 </div>;
}
