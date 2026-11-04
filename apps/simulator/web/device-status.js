'use strict';
// Current execution is determined by the active job, never by a completed run's control flag.
function deviceRuntimeStatus(device, state, freshness){
 const platformFresh=!!freshness.platform&&Object.prototype.hasOwnProperty.call(device,'platform_assignment');
 const enabledLabel=platformFresh?(device.enabled?'已启用':'已停用'):'启用状态未同步';
 const assigned=platformFresh?device.platform_assignment:null;
 const result={label:'状态未同步',tone:'warn',detail:'请刷新后确认设备状态。',enabledLabel,enabledTone:platformFresh?(device.enabled?'good':'bad'):'warn',runId:null,taskId:assigned?.task_id||null};
 if(!freshness.local)return result;
 const activeStatuses=['STARTING','RUNNING','STOPPING'];
 const preparation=state?.starting?.find(j=>j.device_id===device.id&&activeStatuses.includes(j.status));
 const run=state?.runs?.find(r=>r.device_id===device.id&&activeStatuses.includes(r.job?.status));
 const job=preparation||run?.job;
 if(job){
  result.runId=preparation?.run_id||run.id;
  result.label=job.status==='STOPPING'?'停止中':job.status==='STARTING'||preparation?'准备中':job.command==='drain'?'补传中':job.command==='replay'?'重放中':run.control==='PAUSED'?'已暂停':run.scenario==='cable'?'送料中':'采集中';
  result.tone=['送料中','采集中'].includes(result.label)?'good':'warn';
  result.detail=run&&job.command==='run'?`已采样 ${run.generated} / ${run.target} 点`:'当前模拟进程正在执行。';
  if(!platformFresh)result.detail+=' · 平台状态未同步';
  else if(!device.enabled)result.detail+=' · 设备已停用，当前进程尚未结束';
  return result;
 }
 if(!platformFresh)return result;
 if(assigned)return {...result,label:'任务占用',tone:'warn',detail:'当前未送料；切换任务前需结束已有任务。'};
 if(!device.enabled)return {...result,label:'未运行',tone:'',detail:'设备已停用，不能开始新送料。'};
 return {...result,label:'待命',tone:'',detail:'暂无运行任务或送料。'};
}
