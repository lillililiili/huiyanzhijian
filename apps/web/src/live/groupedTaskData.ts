import {useEffect,useState} from 'react';
import type {ApiClient,Task} from './api';

export type TaskListResult={items:Task[];total:number;running:number;ended:number;waiting:number;spools:number;page:number};

// Group only after reading every matching task. API pages must never split a group.
export async function loadWorkOrderTasks(api:ApiClient,query:string,signal:AbortSignal):Promise<TaskListResult>{
  const q=new URLSearchParams(query);
  if(!q.get('work_order_id'))throw Error('缺少工单范围，无法读取任务分组');
  q.set('limit','100');q.set('page','1');
  const read=()=>api.request<TaskListResult>('/production/tasks?'+q,undefined,{},signal,60000);
  const first=await read(),items=[...first.items];
  for(let page=2;items.length<first.total;page++){
    q.set('page',String(page));const next=await read();
    if(next.total!==first.total||!next.items.length)throw Error('任务范围已变化，请刷新任务后重试');
    items.push(...next.items);
  }
  if(items.length!==first.total||new Set(items.map(t=>t.id)).size!==first.total)throw Error('任务分页范围已变化，请刷新任务后重试');
  return {...first,items};
}

export function useWorkOrderTasks(api:ApiClient,query:string|null,revision:number){
  const [value,setValue]=useState<TaskListResult|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();let active=true;setValue(null);setError('');
    if(query)void loadWorkOrderTasks(api,query,controller.signal).then(v=>{if(active)setValue(v);}).catch(e=>{if(active&&!controller.signal.aborted)setError(e.message);});
    return()=>{active=false;controller.abort();};
  },[api,query,revision]);
  return {value,error};
}

export function groupWorkOrderTasks(tasks:Task[]){
  const groups=new Map<string,{key:string;spoolId:string;processId:string;tasks:Task[]}>();
  for(const task of tasks){
    const spoolId=task.canonical_spool_id||task.spool_id;
    // Missing identity must not merge unrelated legacy rows.
    const key=JSON.stringify([task.work_order_id,spoolId||task.id,task.process_id||task.id]);
    if(!groups.has(key))groups.set(key,{key,spoolId,processId:task.process_id,tasks:[]});
    groups.get(key)!.tasks.push(task);
  }
  return [...groups.values()];
}

export function groupSampleCounts(tasks:Task[]){
  if(tasks.some(t=>!t.measurements))return null;
  return tasks.reduce((sum,t)=>({total:sum.total+t.measurements!.total,failed:sum.failed+t.measurements!.failed,invalid:sum.invalid+t.measurements!.invalid,unevaluated:sum.unevaluated+t.measurements!.unevaluated}),{total:0,failed:0,invalid:0,unevaluated:0});
}
