import {useEffect,useState} from 'react';
import {Modal} from '../ui/Modal';
import {Button} from '../ui/Button';
import {names,taskState,type ApiClient,type Workspace} from './api';
import {labelPng,labelFilename,saveLabelFile,zipLabels,type TaskLabel} from './taskLabelFiles';
import './task-labels.css';
type LabelSet={order:{id:string;external_code:string};as_of:string;items:TaskLabel[]};
export function TaskLabels({api,data,orderId,taskId,close}:{api:ApiClient;data:Workspace;orderId:string;taskId?:string;close:()=>void}){
 const [labels,setLabels]=useState<LabelSet>(),[error,setError]=useState(''),[tick,setTick]=useState(0),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 useEffect(()=>{const control=new AbortController();setLabels(undefined);setError('');setNotice('');api.request<LabelSet>('/work-orders/'+encodeURIComponent(orderId)+'/task-labels',undefined,{},control.signal).then(r=>{if(control.signal.aborted)return;setLabels(r);setSelected(r.items.filter(t=>!taskId||t.task_id===taskId).map(t=>t.task_id));}).catch(e=>{if(!control.signal.aborted)setError(e.message);});return()=>control.abort();},[api,orderId,taskId,tick]);
 const process=(t:TaskLabel)=>data.catalog.inspection_process.find(p=>p.id===t.process_id)?.name||t.process_id;
 async function download(items:TaskLabel[],batch:boolean){
  if(busy||!items.length)return;setBusy(true);setError('');setNotice('');
  try{
   // Re-read before export; don't print stale association or renamed cable details.
   const fresh=await api.request<LabelSet>('/work-orders/'+encodeURIComponent(orderId)+'/task-labels');
   const current=items.map(old=>{const t=fresh.items.find(t=>t.task_id===old.task_id);if(!t)throw Error('任务已移出本工单，请刷新条码列表');return t;});
   const files=[];for(let i=0;i<current.length;i++){setNotice(`正在生成 ${i+1} / ${current.length}`);const t=current[i],blob=await labelPng(t,process(t));files.push({name:labelFilename(t),data:new Uint8Array(await blob.arrayBuffer())});await new Promise(resolve=>setTimeout(resolve,0));}
   if(batch){files.push({name:'任务清单.json',data:new TextEncoder().encode(JSON.stringify({as_of:fresh.as_of,order:fresh.order,items:current},null,2))});saveLabelFile(zipLabels(files),`工单任务条码_${fresh.order.external_code.replace(/[<>:"/\\|?*]/g,'_')}.zip`);}
   else saveLabelFile(new Blob([files[0].data],{type:'image/png'}),files[0].name);
   setLabels(fresh);setNotice(`已生成 ${current.length} 张条码，请查看浏览器下载。`);
  }catch(e){setError((e as Error).message);setNotice('');}finally{setBusy(false);}
 }
 return <Modal open title="下载检测任务条码" submitLabel={`批量下载 ${selected.length} 张（ZIP）`} submitDisabled={busy||!selected.length||!labels} onClose={()=>{if(!busy)close();}} onSubmit={async()=>{await download(labels!.items.filter(t=>selected.includes(t.task_id)),true);return false as const;}}>
  <div className="task-label-intro"><strong>{labels?.order.external_code||'正在读取工单'}</strong><span>每个任务一张 Code128 条码 · PNG 图片</span></div>
  <p className="muted small">标签包含工序、线缆编号和任务信息。可提前打印；下载不会启动检测。批量范围为本工单全部任务，不受下方任务列表分页影响。</p>
  <div className="task-label-tools"><Button disabled={busy||!labels?.items.length} onClick={()=>setSelected(labels!.items.map(t=>t.task_id))}>全选</Button><Button disabled={busy||!selected.length} onClick={()=>setSelected([])}>取消选择</Button><Button disabled={busy} onClick={()=>setTick(n=>n+1)}>刷新条码列表</Button><span>已选 {selected.length} / {labels?.items.length??0}</span></div>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!labels&&!error&&<p>正在读取任务…</p>}{labels&&!labels.items.length&&<p>本工单尚无检测任务，请先分配检测任务。</p>}
  <div className="task-label-list">{labels?.items.map(t=><div className="task-label-row" key={t.task_id}><input type="checkbox" aria-label={`选择任务 ${t.task_code}`} disabled={busy} checked={selected.includes(t.task_id)} onChange={e=>setSelected(e.target.checked?[...selected,t.task_id]:selected.filter(id=>id!==t.task_id))}/><div><strong>{t.task_code}</strong><span className="task-label-state">{taskState[t.state]||t.state}</span><div>线缆：{t.spool_code}</div><div className="muted small">{process(t)} · {names[t.metric_code]} · {t.device_id}</div></div><Button disabled={busy} onClick={()=>void download([t],false)}>下载PNG</Button></div>)}</div>
  <p className="muted small">不圆度支持现有边缘扫码流程；搭盖率和铜丝间隙的厂商终端扫码适配尚未接通。采集前按平台当前状态校验，结束或取消任务不能继续采集。</p>
 </Modal>;
}
