import { type ApiClient, type Task } from './api';

export const analyticsMetrics = [
  { code:'SHIELD_OVERLAP_RATE', name:'金属屏蔽搭盖率', short:'搭盖率', unit:'%', color:'#2468cc' },
  { code:'WIRE_GAP', name:'铜丝屏蔽间隙', short:'铜丝间隙', unit:'mm', color:'#149b94' },
  { code:'OVALITY', name:'电缆不圆度', short:'不圆度', unit:'%', color:'#8270d8' },
];
export const resultColors=['#25a18c','#ed6974','#aab7cc'];
export const resultNames=['符合规则','超限','未判定'];
export const numberText=(n:number)=>n.toLocaleString('zh-CN');
export const valueText=(n:number|null)=>n===null?'—':n.toLocaleString('zh-CN',{maximumFractionDigits:4});

// The plain /tasks catalog has no measurement summaries. Never treat that omission as zero.
export async function loadAnalyticsTasks(api:ApiClient,signal:AbortSignal){
  type Result={items:Task[];total:number;as_of:string};
  const first=await api.request<Result>('/production/tasks?page=1&limit=100',undefined,{},signal);
  const tasks=[...first.items];
  for(let page=2;tasks.length<first.total;page++){
    const next=await api.request<Result>(`/production/tasks?page=${page}&limit=100`,undefined,{},signal);
    if(next.total!==first.total||!next.items.length)throw new Error('任务范围已变化，请重新刷新统计');
    tasks.push(...next.items);
  }
  if(new Set(tasks.map(t=>t.id)).size!==first.total)throw new Error('任务分页范围已变化，请重新刷新统计');
  if(tasks.some(t=>!t.measurements))throw new Error('服务端未返回测量摘要，请稍后重试');
  return {tasks,asOf:first.as_of};
}

export function summarizeTasks(tasks:Task[]){
  const sum=(key:'total'|'valid'|'invalid'|'passed'|'failed'|'unevaluated'|'quarantined')=>tasks.reduce((n,t)=>n+(t.measurements?.[key]??0),0);
  const passed=sum('passed'),failed=sum('failed'),pending=sum('unevaluated');
  const unitSet=new Set(tasks.filter(t=>t.measurements?.total).map(t=>t.measurements?.unit||(t.metric_code==='WIRE_GAP'?'mm':'%')));
  const unitsMixed=unitSet.size>1;
  const minimums=tasks.flatMap(t=>t.measurements?.minimum!=null?[Number(t.measurements.minimum)]:[]).filter(Number.isFinite);
  const maximums=tasks.flatMap(t=>t.measurements?.maximum!=null?[Number(t.measurements.maximum)]:[]).filter(Number.isFinite);
  return {total:sum('total'),valid:sum('valid'),invalid:sum('invalid'),quarantined:sum('quarantined'),passed,failed,pending,
    rate:passed+failed?`${(passed/(passed+failed)*100).toFixed(1)} %`:'—',
    taskCount:tasks.length,spools:new Set(tasks.map(t=>t.canonical_spool_id||t.spool_id)).size,
    ...(unitSet.size?{unit:unitsMixed?'混合单位（按任务查看）':String([...unitSet][0])}:{}),
    minimum:!unitsMixed&&minimums.length?Math.min(...minimums):null,maximum:!unitsMixed&&maximums.length?Math.max(...maximums):null,
    simulated:tasks.filter(t=>t.data_environment==='SIMULATED').reduce((n,t)=>n+(t.measurements?.total??0),0),
    real:tasks.filter(t=>t.data_environment==='REAL').reduce((n,t)=>n+(t.measurements?.total??0),0),
  };
}
