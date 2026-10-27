import {useEffect,useState} from 'react';
import {Badge} from '../ui/Badge';
import {Note} from '../ui/Note';
import {useRead} from './ServerLists';
import {labelTime,taskState,quality,type ApiClient,type Task,type TaskActivity} from './api';
export const communicationNames:Record<string,string>={ONLINE:'通信在线',OFFLINE:'通信离线',UNKNOWN:'未建立通信'};
export const samplingNames:Record<string,string>={NO_DATA:'尚无采样',RECENT_DATA:'近期收到数据',NO_RECENT_DATA:'近期未更新',DELAYED_DATA:'收到迟到数据',CLOCK_UNVERIFIED:'来源时钟待核对'};
export function ActivityStatus({activity:a}:{activity?:TaskActivity}){
 if(!a)return <span className="muted">采集状态待查询</span>;
 return <div className="b3r4-activity"><div><Badge tone={a.communication==='ONLINE'?'blue':'amber'}>{communicationNames[a.communication]||'通信未知'}</Badge></div>
 <div>{samplingNames[a.sampling]||'采样未知'} · {a.observation_seconds}秒观察窗</div>
 {a.task_state!=='RUNNING'&&<div>{taskState[a.task_state]} · 非运行任务</div>}
 {a.latest&&<><div>末次数据：{a.latest.data_status==='VALID'?'有效':a.latest.data_status==='MISSING'?'缺测':'无效'} · {a.latest.receipt_status==='QUARANTINED'?'隔离':quality[a.latest.quality_result]||'未判定'}</div><div className="muted small">接收：{labelTime(a.latest.received_at)}</div></>}
 </div>;
}
export function TaskActivityPanel({api,task,compact=false}:{api:ApiClient;task:Task;compact?:boolean}){
 const [tick,setTick]=useState(0);useEffect(()=>{if(task.state!=='RUNNING')return;const timer=setInterval(()=>setTick(n=>n+1),5000);return()=>clearInterval(timer);},[task.state]);
 const {value,error}=useRead<TaskActivity>(api,'/task-activity/'+task.id,task.version+':'+tick);
 if(compact)return <div>{error?<span role="alert">采集状态读取失败：{error}</span>:<ActivityStatus activity={value||undefined}/>}</div>;
 return <Note>{error?<span role="alert">采集状态读取失败：{error}</span>:<ActivityStatus activity={value||undefined}/>}任务状态、设备通信与采样有效性分别记录；30秒仅为显示观察窗，不是停线或断流报警标准。</Note>;
}
