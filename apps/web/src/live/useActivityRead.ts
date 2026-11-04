import {useEffect,useState} from 'react';
import {startVisiblePolling} from '../shared/refreshPolicy';
import type {ApiClient,DeviceStatus,Task} from './api';

/** Lightweight status only; keep the last snapshot during refresh and identify failures. */
export function useActivityRead<T>(api:ApiClient,path:string|null,poll=true,revision:unknown=0){
 const [read,setRead]=useState<{path:string|null;value:T|null;error:string}>({path:null,value:null,error:''});
 useEffect(()=>{
  if(!path)return;
  const controller=new AbortController();let active=true,inFlight=false;
  async function load(){
   if(inFlight)return;inFlight=true;
   try{const value=await api.request<T>(path!,undefined,{},controller.signal,15000);if(active)setRead({path,value,error:''});}
   catch(e){if(active&&!controller.signal.aborted)setRead(previous=>({path,value:previous.path===path?previous.value:null,error:e instanceof Error?e.message:'状态读取失败'}));}
   finally{inFlight=false;}
  }
  void load();const stop=poll?startVisiblePolling(load,5000):undefined;
  return()=>{active=false;controller.abort();stop?.();};
 },[api,path,poll,revision]);
 return read.path===path?read:{path,value:null,error:''};
}
export type ActivityOverview={as_of:string;connections:DeviceStatus[];tasks:Task[]};
export function useRunningActivities(api:ApiClient,tasks:Task[]){
 const enabled=tasks.some(t=>t.state==='RUNNING');
 const {value,error}=useActivityRead<ActivityOverview>(api,enabled?'/operations/overview':null);
 return (task:Task)=>{
  if(task.state!=='RUNNING')return {activity:task.activity,error:''};
  const current=value?.tasks?.find(t=>t.id===task.id);
  return {activity:current?.activity||(!value?task.activity:undefined),error:error||(value&&!current?'任务已不在运行监控中，请刷新任务列表':'')};
 };
}
