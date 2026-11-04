import type {TaskActivity} from './api';

/** Display evidence only. Never changes lifecycle, quality, or physical feed state. */
export function observedActivity(a:TaskActivity|undefined,elapsedSeconds=0):TaskActivity|undefined {
 if(!a||a.task_state!=='RUNNING'||!a.latest)return a;
 const elapsed=Math.max(0,elapsedSeconds),window=a.observation_seconds||30;
 const received=a.received_age_seconds==null?null:a.received_age_seconds+elapsed;
 const sample=a.sample_age_seconds==null?null:a.sample_age_seconds+elapsed;
 // Preserve invalid-clock evidence until a new server observation arrives.
 const sampling=a.sampling==='CLOCK_UNVERIFIED'?a.sampling:received!==null&&received>window?'NO_RECENT_DATA':a.sampling;
 return {...a,sampling,received_age_seconds:received,sample_age_seconds:sample};
}

export function collectionState(state:string,a?:TaskActivity,error='') {
 if(state==='ENDED')return {label:'已结束',tone:'gray',detail:'任务已结束；末次结果为历史记录'};
 if(state==='CANCELLED')return {label:'已取消',tone:'gray',detail:'任务已取消；原记录保留'};
 if(state==='CREATED')return {label:'待开始',tone:'gray',detail:'任务尚未开始'};
 if(error)return {label:'采集状态待确认',tone:'amber',detail:error};
 if(!a)return {label:'采集状态待查询',tone:'gray',detail:'尚未取得当前采样状态'};
 if(a.task_state&&a.task_state!==state)return collectionState(a.task_state,undefined);
 switch(a.sampling){
  case 'NO_DATA':return {label:'等待首条数据',tone:'amber',detail:'任务运行中，尚未收到本任务采样'};
  case 'NO_RECENT_DATA':return {label:'暂无新数据',tone:'amber',detail:`超过${a.observation_seconds||30}秒未更新；任务仍运行，不能据此确认无料`};
  case 'DELAYED_DATA':return {label:'接收补传数据',tone:'amber',detail:'收到较早时刻的采样，不表示机器正在检测'};
  case 'CLOCK_UNVERIFIED':return {label:'采样时钟待核对',tone:'amber',detail:'来源时间异常，无法确认当前采集'};
  case 'RECENT_DATA':{
   const r=a.latest;
   if(!r)return {label:'采集状态待确认',tone:'amber',detail:'状态与采样摘要不完整'};
   if(r.receipt_status==='QUARANTINED')return {label:'采样已隔离',tone:'red',detail:'近期数据被隔离，请查看记录原因'};
   if(r.data_status==='MISSING')return {label:'采样缺测',tone:'amber',detail:'近期收到缺测记录，不能作为有效检测值'};
   if(r.data_status!=='VALID'||r.value===null)return {label:'采样异常',tone:'red',detail:'近期数据无效，请查看原始记录'};
   if(a.communication==='OFFLINE')return {label:'收到数据 · 通信离线',tone:'amber',detail:'近期有有效采样，但设备心跳离线，需核对链路'};
   return {label:a.communication==='ONLINE'?'采集中':'正在接收数据',tone:'blue',detail:'观察窗内收到有效采样；质量结论另行显示'};
  }
  default:return {label:'采集状态待确认',tone:'gray',detail:'当前采样状态未知'};
 }
}
