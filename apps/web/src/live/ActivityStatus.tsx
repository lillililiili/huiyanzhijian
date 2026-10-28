import {useEffect,useState} from 'react';
import {Badge} from '../ui/Badge';
import {Note} from '../ui/Note';
import {useRead} from './ServerLists';
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

export function ActivityStatus({activity:a}:{activity?:TaskActivity}){
 if(!a)return <span className="muted">采集状态待查询</span>;
 const dataStatus=a.latest?(a.latest.data_status==='VALID'?'有效':a.latest.data_status==='MISSING'?'缺测':'无效'):'';
 const isQuarantined=a.latest?.receipt_status==='QUARANTINED';
 const qualityText=a.latest?(isQuarantined?'隔离':quality[a.latest.quality_result]||'未判定'):'';

 const dataTone=a.latest?(a.latest.data_status==='VALID'?'valid':a.latest.data_status==='MISSING'?'missing':'invalid'):'';
 const qualityTone=a.latest?(isQuarantined?'quarantined':a.latest.quality_result==='PASS'?'pass':a.latest.quality_result==='FAIL'?'fail':'unevaluated'):'';
 const samplingTone=a.sampling==='RECENT_DATA'?'recent':a.sampling==='NO_RECENT_DATA'?'stale':a.sampling==='DELAYED_DATA'?'delayed':a.sampling==='CLOCK_UNVERIFIED'?'clock':'none';

 return (
  <div className="b3r4-activity">
    <div className="b3r4-status-row">
      <Badge tone={a.communication==='ONLINE'?'blue':'amber'}>
        {communicationNames[a.communication]||'通信未知'}
      </Badge>
      <span className={`b3r4-sampling-pill tone-${samplingTone}`} title={`采样观察窗口：${a.observation_seconds}秒`}>
        {samplingNames[a.sampling]||'采样未知'}
      </span>
    </div>
    {a.latest ? (
      <div className="b3r4-latest-row">
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
 const [tick,setTick]=useState(0);useEffect(()=>{if(task.state!=='RUNNING')return;const timer=setInterval(()=>setTick(n=>n+1),5000);return()=>clearInterval(timer);},[task.state]);
 const {value,error}=useRead<TaskActivity>(api,'/task-activity/'+task.id,task.version+':'+tick);
 if(compact)return <div>{error?<span role="alert">采集状态读取失败：{error}</span>:<ActivityStatus activity={value||undefined}/>}</div>;
 return <Note>{error?<span role="alert">采集状态读取失败：{error}</span>:<ActivityStatus activity={value||undefined}/>}任务状态、设备通信与采样有效性分别记录；30秒仅为显示观察窗，不是停线或断流报警标准。</Note>;
}
