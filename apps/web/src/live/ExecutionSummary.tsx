import {Badge} from '../ui/Badge';
import {HashLink} from '../ui/HashLink';
import {Icon} from '../ui/Icon';
import {communicationNames,samplingNames} from './ActivityStatus';
import {names,shortCode,taskState,labelTime,type Task,type Workspace} from './api';

// Legacy records may use their UUID as task_code. Keep the original identity accessible.
export function taskDisplayLabel(task:Task){
  return !task.task_code || task.task_code===task.id || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(task.task_code)
    ? `旧任务 · ${task.id.slice(0,8)}` : task.task_code;
}

export function ExecutionSummary({tasks,data,asOf}:{tasks:Task[];data:Workspace;asOf:string}){
  const stale=tasks.filter(t=>t.activity?.sampling==='NO_RECENT_DATA').length;
  const empty=tasks.filter(t=>t.activity?.sampling==='NO_DATA').length;
  return <div className="execution-summary">
    <div className="execution-overview">
      <div className="execution-counts"><span>运行任务 <strong>{tasks.length}</strong></span><span className={stale?'text-red':''}>近期未更新 <strong>{stale}</strong></span><span>尚无采样 <strong>{empty}</strong></span></div>
      <span className="muted small">30秒采样观察窗 · 非报警判定</span>
    </div>
    {tasks.length?<ul className="execution-list" aria-label="当前运行任务">{tasks.map(task=>{
      const current=data.tasks.find(t=>t.id===task.id)||task;
      const spool=task.current_spool_code||data.spools.find(s=>s.id===task.spool_id)?.spool_code||task.context_snapshot?.spool_code||'盘号待确认';
      const order=task.current_order_code||data.orders.find(o=>o.id===task.work_order_id)?.external_code||'工单待确认';
      const activity=task.activity;
      return <li className="execution-item" key={task.id}>
        <div className="execution-identity"><div className="execution-title"><HashLink title={spool} route={'task?id='+task.id+'&back=dashboard'}>{spool}</HashLink><Badge tone="blue">{taskState[task.state]||task.state}</Badge></div><span className="muted execution-order" title={order}>工单 {order}</span><details className="execution-id"><summary>{taskDisplayLabel(current)}</summary><span>盘号：{spool}</span><span>工单：{order}</span><span>任务编号：{current.task_code||'未分配'}</span><span>内部ID：{task.id}</span></details></div>
        <div className="execution-device"><span className="muted small">检测项 / 设备</span><strong>{names[task.metric_code]||task.metric_code}</strong><span>{task.device_id}</span></div>
        <div className="execution-activity"><span className="muted small">通信与采样</span><div><Badge tone={activity?.communication==='ONLINE'?'green':'amber'}>{activity?communicationNames[activity.communication]||'通信未知':'通信待查询'}</Badge></div><span>{activity?samplingNames[activity.sampling]||'采样未知':'采样待查询'}</span></div>
        <div className="execution-actions"><HashLink className="btn primary" route={`detection?metric=${shortCode(task.metric_code)}&task=${task.id}&back=dashboard`}>查看检测<Icon name="chevron-right" size={14}/></HashLink><HashLink route={'task?id='+task.id+'&back=dashboard'}>任务详情</HashLink></div>
      </li>;
    })}</ul>:<div className="execution-empty"><Icon name="clipboard" size={28}/><strong>当前没有运行任务</strong><p>可在检测任务中查看待开始或历史任务。</p><HashLink route="tasks">查看检测任务</HashLink></div>}
    <p className="execution-updated muted small">摘要更新：{labelTime(asOf)} · 通信在线不等于有效采样</p>
  </div>;
}
