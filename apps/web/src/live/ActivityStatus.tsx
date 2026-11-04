import {observedActivity,collectionState} from './collectionState';
import {useActivityRead} from './useActivityRead';
import {useEffect,useState,useRef} from 'react';
import {Badge} from '../ui/Badge';
import {labelTime,quality,type ApiClient,type Task,type TaskActivity} from './api';

export const communicationNames:Record<string,string>={ONLINE:'通信在线',OFFLINE:'通信离线',UNKNOWN:'未建立通信'};
export const samplingNames:Record<string,string>={NO_DATA:'尚无采样',RECENT_DATA:'近期收到数据',NO_RECENT_DATA:'近期未更新',DELAYED_DATA:'收到迟到数据',CLOCK_UNVERIFIED:'来源时钟待核对'};

function FormattedReceivedTime({iso}:{iso:string}){
  const full=labelTime(iso);
  const m=full.match(/^(\d{4})-(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(\.\d+)?(\s+北京时间)?$/);
  if(!m)return <span title={full}>{full}</span>;
  const [,,,clock,fraction]=m;
  return (
    <span className="b3r4-time-val" title={`接收时间：${full}`}>
      <span className="time-clock">{clock}</span>
      {fraction&&<span className="time-sub">{fraction}</span>}
    </span>
  );
}

export function useObservedActivity(activity?:TaskActivity){
 const seen=useRef({activity,at:Date.now()});const [now,setNow]=useState(Date.now());
 if(seen.current.activity!==activity)seen.current={activity,at:Date.now()};
 useEffect(()=>{if(activity?.task_state!=='RUNNING')return;const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[activity?.task_state]);
 return observedActivity(activity,Math.max(0,now-seen.current.at)/1000);
}
export function TaskExecutionStatus({state,activity,error='',detail=true}:{state:string;activity?:TaskActivity;error?:string;detail?:boolean}){
 const a=useObservedActivity(activity),status=collectionState(state,a,error);
 return <div className="collection-status" title={status.detail}><Badge tone={status.tone}>{status.label}</Badge>{detail&&state==='RUNNING'&&(!a?.task_state||a.task_state==='RUNNING')&&<div className="muted small">任务仍在运行</div>}</div>;
}
export function ActivityStatus({activity,error=''}:{activity?:TaskActivity;error?:string}){
 const a=useObservedActivity(activity);
 if(!a)return <span className="muted">采集状态待查询</span>;
 const dataStatus=a.latest?(a.latest.data_status==='VALID'?'有效':a.latest.data_status==='MISSING'?'缺测':'无效'):'';
 const isQuarantined=a.latest?.receipt_status==='QUARANTINED';
 const qualityText=a.latest?(isQuarantined?'隔离':a.latest.data_status!=='VALID'?'无法用于质量比较':quality[a.latest.quality_result]||'请查看采样详情'):'';

 const dataTone=a.latest?(a.latest.data_status==='VALID'?'valid':a.latest.data_status==='MISSING'?'missing':'invalid'):'';
 const qualityTone=a.latest?(isQuarantined?'quarantined':a.latest.quality_result==='PASS'?'pass':a.latest.quality_result==='FAIL'?'fail':'unevaluated'):'';
 const samplingTone=a.sampling==='RECENT_DATA'?'recent':a.sampling==='NO_RECENT_DATA'?'stale':a.sampling==='DELAYED_DATA'?'delayed':a.sampling==='CLOCK_UNVERIFIED'?'clock':'none';

 return (
  <div className="b3r4-activity">{error&&<div className="text-red" role="alert">状态更新失败 · 以下为上次记录</div>}
    <div className="b3r4-status-row">
      <Badge tone={a.communication==='ONLINE'?'blue':'amber'}>
        {communicationNames[a.communication]||'通信未知'}
      </Badge>
      <span className={`b3r4-sampling-pill tone-${samplingTone}`} title={`采样观察窗口：${a.observation_seconds}秒`}>
        {samplingNames[a.sampling]||'采样未知'}
      </span>
    </div>
    {a.latest ? (
      <div className="b3r4-latest-row"><span className="muted small">末次记录</span>
        <span className={`b3r4-eval-pill tone-${qualityTone}`} title={`末次判定：${dataStatus} · ${qualityText}`}>
          <span className={`eval-data tone-${dataTone}`}>{dataStatus}</span>
          <span className="eval-dot">·</span>
          <span className="eval-quality">{qualityText}</span>
        </span>
        <FormattedReceivedTime iso={a.latest.received_at}/>
      </div>
    ) : (
      <div className="b3r4-no-data muted small">尚无末次数据</div>
    )}
  </div>
 );
}

export function TaskActivityPanel({api,task,compact=false}:{api:ApiClient;task:Task;compact?:boolean}){
 const {value,error}=useActivityRead<TaskActivity>(api,'/task-activity/'+task.id,task.state==='RUNNING'||task.state==='CREATED',task.version);
 return <div className={compact?'':'note'}><TaskExecutionStatus state={task.state} activity={value||undefined} error={error}/>{error&&<span role="alert">采集状态读取失败：{error}</span>}<ActivityStatus activity={value||undefined} error={error}/>{!compact&&<div className="muted small">任务是否结束与当前采样分开显示；超过30秒未收到更新显示暂无新数据，不能据此推断无料或自动结束任务。</div>}</div>;
}
