import {Fragment,useId,useState,type ReactNode} from 'react';
import {Button} from '../ui/Button';
import {HashLink} from '../ui/HashLink';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {names,taskState,type Task,type Workspace} from './api';
import {groupSampleCounts,groupWorkOrderTasks} from './groupedTaskData';
import './workOrderTaskGroups.css';

export function WorkOrderTaskGroups({tasks,data,back,headers,renderTask,page:onPage,pageChange}:{tasks:Task[];data:Workspace;back:string;headers:string[];renderTask:(task:Task)=>ReactNode[];page:number;pageChange:(page:number)=>void}){
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set()),prefix=useId();
  const groups=groupWorkOrderTasks(tasks),pages=Math.max(1,Math.ceil(groups.length/20));
  const page=Math.min(Math.max(1,onPage||1),pages),visible=groups.slice((page-1)*20,page*20);
  return <><Panel core table title="检测任务 · 按线缆与工序汇总">
    <p className="wg-help">当前筛选内 {groups.length} 组 · {tasks.length} 个任务。展开查看各次采集；样本累计不代表整盘合格。</p>
    <div className="table-wrap"><table className="wg-table"><thead><tr>{['线缆 / 盘号','工序 / 检测项目','采集任务 / 执行状态','累计采样','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
    {!visible.length&&<tr><td colSpan={5}>未找到符合条件的任务</td></tr>}
    {visible.map((group,index)=>{
      const first=group.tasks[0],open=expanded.has(group.key),detailsId=prefix+'-'+index;
      const spool=data.spools.find(s=>s.id===group.spoolId);
      const code=spool?.spool_code||group.tasks.find(t=>t.spool_id===group.spoolId)?.current_spool_code||first.current_spool_code||first.context_snapshot.spool_code||group.spoolId;
      const process=data.catalog.inspection_process.find(p=>p.id===group.processId)?.name||group.processId||'工序未知';
      const counts=groupSampleCounts(group.tasks),devices=[...new Set(group.tasks.map(t=>t.device_id))];
      return <Fragment key={group.key}><tr className={open?'wg-open':''}>
        <td><HashLink route={'trace?spool='+encodeURIComponent(group.spoolId)+'&back='+encodeURIComponent(back)}>{code}</HashLink><div className="small muted" title={group.spoolId}>线缆 ID · {group.spoolId.slice(-8)}</div></td>
        <td><strong>{process}</strong><div className="small muted">{[...new Set(group.tasks.map(t=>names[t.metric_code]||t.metric_code))].join('、')}</div><div className="small muted" title={devices.join('、')}>{devices.length===1?devices[0]:`${devices.length} 台设备`} · {[...new Set(group.tasks.map(t=>t.data_environment==='SIMULATED'?'模拟':'真实设备'))].join(' / ')}</div></td>
        <td><strong>{group.tasks.length} 个任务</strong><div className="wg-states">{Object.entries(taskState).map(([state,label])=>{const count=group.tasks.filter(t=>t.state===state).length;return count?<span key={state} className={'wg-state wg-'+state}>{label} {count}</span>:null;})}</div></td>
        <td>{counts?<><strong>{counts.total.toLocaleString('zh-CN')} 个样本</strong><div className="small"><span className={counts.failed?'text-red':''}>超限 {counts.failed.toLocaleString('zh-CN')}</span> · 无效 {counts.invalid.toLocaleString('zh-CN')}</div><div className="small muted">未判定 {counts.unevaluated.toLocaleString('zh-CN')}</div></>:<span className="muted">摘要不完整 · 展开查看</span>}</td>
        <td><button className="btn wg-toggle" aria-expanded={open} aria-controls={detailsId} aria-label={`${open?'收起':'展开'} ${code} · ${process} 的 ${group.tasks.length} 个任务`} onClick={()=>setExpanded(old=>{const next=new Set(old);if(open)next.delete(group.key);else next.add(group.key);return next;})}><span aria-hidden="true">{open?'▾':'▸'}</span> {open?'收起任务':`展开 ${group.tasks.length} 个任务`}</button></td>
      </tr><tr hidden={!open} className="wg-detail"><td colSpan={5} id={detailsId}>{open&&<><div className="wg-detail-title">{code} · {process}<span>各次采集独立保留，最近任务在前</span></div><DataTable className="ux-task-table" headers={headers} rows={group.tasks.map(renderTask)}/></>}</td></tr></Fragment>;
    })}</tbody></table></div>
  </Panel><div className="row"><Button disabled={page===1} onClick={()=>pageChange(page-1)}>上一页</Button><span>第 {page} 页 / {pages} 页 · 每页 20 组</span><Button disabled={page===pages} onClick={()=>pageChange(page+1)}>下一页</Button></div></>;
}
