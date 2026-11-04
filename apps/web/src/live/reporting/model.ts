export const kinds={DAILY:'日报',WEEKLY:'周报',MONTHLY:'月报',QUARTERLY:'季报',YEARLY:'年报',WORK_ORDER:'工单报'};
export type Kind=keyof typeof kinds;
export const metrics:Record<string,string>={SHIELD_OVERLAP_RATE:'金属屏蔽搭盖率',WIRE_GAP:'铜丝屏蔽间隙',OVALITY:'电缆不圆度',SHEATH_THICKNESS:'护套厚度'};
export type ScopeInput={kind:Kind;anchor:string;order_id:string;environment:string;presentation:{supplier:string;recipient:string;title:string;trends:boolean;details:boolean}};
export type Stats={total:number;valid:number;passed:number;failed:number;invalid:number;unevaluated:number;quarantined:number;minimum?:number|null;maximum?:number|null;average?:number|null;sum?:number|null};
export type MetricStats=Stats&{metric_code:string;unit:string;method_id:string;task_id?:string;bucket?:string};
export type Snapshot={id?:string;report_code?:string;snapshot_hash?:string;schema:string;scope:ScopeInput&{from:string|null;to:string|null;label:string;bucket:string};presentation:ScopeInput['presentation'];captured_at:string;generated_by:string;factory_id:string;totals:Stats;metrics:MetricStats[];taskStats:MetricStats[];timeline:MetricStats[];tasks:any[];orders:any[];spools:any[];exceptions:any[];trace:{high_watermark:string|null;last_sample:string|null};taskSeries?:{task_id:string;metric_code:string;unit:string;method_id:string;points:{id:string;at:string;value:number|null;result:string}[]}[];series_method?:string};
export const num=(v:unknown,d=2)=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d});
export const rate=(s:Stats)=>s.passed+s.failed?`${(s.passed/(s.passed+s.failed)*100).toFixed(2)}%`:'—';
export const unit=(u:string)=>u==='1'?'比值':u;
export const time=(s:string)=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
export const groupKey=(s:MetricStats)=>[s.metric_code,s.unit,s.method_id].join('|');
export function ruleText(r:any,u=''):string{if(!r?.comparison)return '缺少判定规则';const b=r.comparison;const bounds=[b.lower!=null?`≥ ${b.lower}`:'',b.upper!=null?`≤ ${b.upper}`:''].filter(Boolean).join('，');return `${bounds} ${unit(u||r.unit||'')}${r.approval_state==='TEST_ONLY'?' · 未批准规则':''}`;}
export function matrix(s:Snapshot){return s.spools.map(sp=>({spool:sp,columns:Object.keys(metrics).map(metric=>{const tasks=s.tasks.filter(t=>t.spool_id===sp.id&&t.metric_code===metric);const stats=s.taskStats.filter(t=>tasks.some(x=>x.id===t.task_id));const total=stats.reduce((n,x)=>n+x.total,0),failed=stats.reduce((n,x)=>n+x.failed,0),other=stats.reduce((n,x)=>n+x.invalid+x.unevaluated,0);return {metric,total,failed,other,label:!total?'无记录':failed?`${num(failed,0)} 条超限`:other?'需核查':'记录符合'};})}));}
export function conclusion(s:Snapshot){const t=s.totals;return !t.total?'所选范围无检测记录。':`纳入 ${num(t.total,0)} 条检测记录，涉及 ${s.spools.length} 根线缆、${s.tasks.length} 个检测任务。${t.failed?`其中 ${num(t.failed,0)} 条超出任务冻结界限，应完成问题复核。`:t.passed?'已判定记录均符合任务冻结界限。':'本范围尚无有效的明确判定。'}${t.invalid+t.unevaluated?`另有 ${num(t.invalid+t.unevaluated,0)} 条记录需核查有效性或判定依据。`:''}记录符合率为 ${rate(t)}，分母为有明确判定的有效记录。`;
}
