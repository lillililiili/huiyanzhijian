import {useId} from 'react';
import type {Kind} from './model';

const years = Array.from({length:101},(_,i)=>2000+i);
const day = (date:Date)=>date.toISOString().slice(0,10);

// Calendar arithmetic uses UTC fields; these dates denote Beijing calendar days.
// M06 accepts an anchor day and applies the actual UTC+8 query boundaries.
export function periodRange(kind:Kind,anchor:string):string|null {
  if(kind==='WORK_ORDER') return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const start=new Date(`${anchor}T00:00:00Z`);
  if(!Number.isFinite(+start)||day(start)!==anchor||start.getUTCFullYear()<2000||start.getUTCFullYear()>2100) return null;
  if(kind==='WEEKLY') start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  if(kind==='MONTHLY') start.setUTCDate(1);
  if(kind==='QUARTERLY') start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3,1);
  if(kind==='YEARLY') start.setUTCMonth(0,1);
  const end=new Date(start);
  if(kind==='DAILY') end.setUTCDate(end.getUTCDate()+1);
  if(kind==='WEEKLY') end.setUTCDate(end.getUTCDate()+7);
  if(kind==='MONTHLY') end.setUTCMonth(end.getUTCMonth()+1);
  if(kind==='QUARTERLY') end.setUTCMonth(end.getUTCMonth()+3);
  if(kind==='YEARLY') end.setUTCFullYear(end.getUTCFullYear()+1);
  end.setUTCDate(end.getUTCDate()-1);
  return `${day(start)} 至 ${day(end)}`;
}

export function PeriodSelector({kind,anchor,disabled,onChange}:{kind:Kind;anchor:string;disabled:boolean;onChange:(anchor:string)=>void}) {
  const id=useId();
  if(kind==='WORK_ORDER') return null;
  const range=periodRange(kind,anchor);
  const year=range?anchor.slice(0,4):'';
  const quarter=range?String(Math.ceil(Number(anchor.slice(5,7))/3)):'';
  const label=kind==='MONTHLY'?'统计月份':kind==='QUARTERLY'?'统计季度':kind==='YEARLY'?'统计年份':kind==='WEEKLY'?'统计周（选择周内日期）':'统计日期';
  const yearInput=<select aria-label="统计年份" value={year} disabled={disabled} onChange={e=>onChange(`${e.target.value}-${kind==='QUARTERLY'?String((Number(quarter||1)-1)*3+1).padStart(2,'0'):'01'}-01`)}><option value="" disabled>选择年份</option>{years.map(y=><option key={y} value={y}>{y}年</option>)}</select>;
  return <div className="rp-period" role="group" aria-labelledby={id}>
    <span id={id}>{label}</span>
    {kind==='MONTHLY'?<input type="month" aria-label={label} min="2000-01" max="2100-12" value={range?anchor.slice(0,7):''} disabled={disabled} onChange={e=>onChange(e.target.value?`${e.target.value}-01`:'')}/>:
     kind==='QUARTERLY'?<div className="rp-period-pair">{yearInput}<select aria-label="统计季度" value={quarter} disabled={disabled} onChange={e=>onChange(`${year||new Date().getFullYear()}-${String((Number(e.target.value)-1)*3+1).padStart(2,'0')}-01`)}><option value="" disabled>选择季度</option>{[1,2,3,4].map(q=><option key={q} value={q}>第{q}季度（{(q-1)*3+1}—{q*3}月）</option>)}</select></div>:
     kind==='YEARLY'?yearInput:
     <input type="date" aria-label={label} min="2000-01-01" max="2100-12-31" value={anchor} disabled={disabled} onChange={e=>onChange(e.target.value)}/>}
    <small className="rp-period-range" aria-live="polite">{range?<>统计范围：<strong>{range}</strong><span>北京时间 · 含起止日{kind==='WEEKLY'?' · 周一至周日':''}</span></>:'请选择有效的统计周期'}</small>
  </div>;
}
