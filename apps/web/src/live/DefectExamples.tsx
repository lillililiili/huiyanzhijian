import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button} from '../ui/Button';
import {Badge} from '../ui/Badge';
import {Panel} from '../ui/Panel';
import {useDialog} from '../ui/useDialog';
import {matchDefect} from './defectMatch';
import {DefectRecordGraphic} from './DefectRecordGraphic';
import {labelTime,names,ruleText,type ApiClient,type Task,type Measurement,type Page} from './api';
import './defect-examples.css';

type ViewerProps={api:ApiClient;task?:Task;record?:Measurement;context:string;onClose:()=>void};
export function DefectExampleViewer(props:ViewerProps){
 return <RecordViewer key={props.task?.id+':'+props.record?.id} {...props}/>;
}
function RecordViewer({api,task,record,context,onClose}:ViewerProps){
 const [pages,setPages]=useState<Page<Measurement>[]>([]),[selected,setSelected]=useState(0),[busy,setBusy]=useState(!record),[error,setError]=useState(''),[retry,setRetry]=useState(0),[zoom,setZoom]=useState(false);
 const ref=useRef<HTMLElement>(null),active=useRef(true),lock=useRef(false),controller=useRef<AbortController|null>(null);
 useDialog(true,onClose,ref,'button');
 const path=task?'/measurements?'+new URLSearchParams({task_id:task.id,metric_code:task.metric_code,quality:'FAIL',data_status:'VALID',receipt_status:'STORED',limit:'25',order:'desc'}):null;
 useEffect(()=>{
  active.current=true;const abort=new AbortController();controller.current=abort;
  if(record){setBusy(false);return()=>{active.current=false;abort.abort();};}
  setPages([]);setSelected(0);setError('');setBusy(true);
  if(!path){setBusy(false);setError('无法确定任务，未查询异常记录。');}
  else api.request<Page<Measurement>>(path,undefined,{},abort.signal).then(page=>{if(!abort.signal.aborted){setPages([page]);setBusy(false);}}).catch(e=>{if(!abort.signal.aborted){setError(e.message);setBusy(false);}});
  return()=>{active.current=false;abort.abort();};
 },[api,path,record,retry]);
 const rows=record?[record]:pages.flatMap(p=>p.items),current=rows[selected],last=pages[pages.length-1],match=current?matchDefect(current,task):null;
 async function next(){
  if(lock.current||busy)return;
  if(selected+1<rows.length){setSelected(n=>n+1);setZoom(false);setError('');return;}
  if(!last?.has_more||!path)return;
  if(!last.next_cursor){setError('分页游标缺失，请重新查询。');return;}
  lock.current=true;setBusy(true);setError('');
  try{
   const nextPage=await api.request<Page<Measurement>>(path+'&cursor='+encodeURIComponent(last.next_cursor),undefined,{},controller.current?.signal);
   if(!active.current)return;
   if(nextPage.items.some(n=>rows.some(old=>old.id===n.id)))throw Error('异常分页返回重复记录，请重新查询。');
   setPages(p=>[...p,nextPage]);if(nextPage.items.length){setSelected(rows.length);setZoom(false);}
  }catch(e){if(active.current)setError((e as Error).message);}finally{lock.current=false;if(active.current)setBusy(false);}
 }
 return createPortal(<div className="overlay"><section className="modal defect-viewer" ref={ref} role="dialog" aria-modal="true" aria-label="异常记录图片预览" tabIndex={-1}>
 <div className="modal-header"><h2>异常记录与图片</h2><Button onClick={onClose} aria-label="关闭图片预览">关闭</Button></div>
 <div className="defect-viewer-body"><p className="defect-context">{context}</p>
 {error&&<p role="alert" className="text-red">异常记录查询失败：{error} <Button disabled={busy} onClick={()=>setRetry(n=>n+1)}>重新查询</Button></p>}
 {busy&&!current&&<p role="status">正在读取真实异常记录…</p>}
 {!busy&&!error&&!current&&<p>当前查询范围没有有效、已存储的超限记录。</p>}
 {current&&<>
 <div className="row"><Badge tone="red">{names[current.metric_code]||current.metric_code} · 超限</Badge><strong>{match?.name||'图片暂不可匹配'}</strong><Badge tone="amber">本条实值绘图 · 非实拍</Badge></div>
 <dl className="defect-facts"><div><dt>采样时间</dt><dd>{labelTime(current.raw_payload.sample_time)}</dd></div><div><dt>来源米数（未验证）</dt><dd>{current.raw_payload.position_m??'未知'} m</dd></div><div><dt>检测值</dt><dd>{current.value??'—'} {current.unit}</dd></div><div><dt>任务冻结规则</dt><dd>{task?ruleText(task.rule_snapshot):'不可用'}</dd></div></dl>
 {match?.direction?<><div className={'defect-stage'+(zoom?' defect-stage-zoom':'')}><DefectRecordGraphic key={current.id} record={current} task={task}/></div><div className="row defect-toolbar"><Button onClick={()=>setZoom(v=>!v)}>{zoom?'适应窗口':'放大查看'}</Button></div></>:<p role="status" className="defect-disclaimer">{match?.reason}</p>}
 <p className="muted small defect-context">记录ID：{current.id} · {current.raw_payload.data_environment==='SIMULATED'?'模拟器数据':'设备数据'} · {current.raw_payload.device_id}</p>
 </>}
 </div>
 {!record&&<div className="row defect-toolbar"><Button disabled={busy||selected===0} onClick={()=>{setSelected(n=>n-1);setZoom(false);setError('');}}>上一条异常</Button><span>{rows.length?`第 ${selected+1} 条 · 已加载 ${rows.length} 条`:''}{last?.has_more?' · 还有更多':''}</span><Button disabled={busy||(!last?.has_more&&selected+1>=rows.length)} onClick={()=>void next()}>{busy?'正在查询…':'下一条异常'}</Button></div>}
 </section></div>,document.body);
}
type Props={api:ApiClient;task?:Task;record?:Measurement;failed?:number;total?:number;context:string;compact?:boolean;onPreview?:()=>void};
export function DefectExamples({api,task,record,failed,total,context,compact=false,onPreview}:Props){
 const [open,setOpen]=useState(false);
 if(failed===undefined)return compact?null:<p className="muted">异常摘要暂不可用。</p>;
 if(failed<=0)return compact?null:<p className="muted">{total===0?'尚无采样，暂无异常图片。':'当前范围暂无超限记录。'}</p>;
 const trigger=<button type="button" className={`defect-preview-link${compact?' compact':''}`} onClick={()=>onPreview?onPreview():setOpen(true)} aria-label={`查看异常图片：${context}`} title={`${failed}条超限 · 按实际记录绘图`}>
 <span aria-hidden="true" className="defect-record-icon">▤</span><span>异常图片{compact?<b className="defect-count">({failed})</b>:<span className="muted small">{failed}条超限 · 按实际记录绘图</span>}</span></button>;
 const viewer=open?<DefectExampleViewer {...{api,task,record,context}} onClose={()=>setOpen(false)}/>:null;
 return compact?<div className="defect-compact">{trigger}{viewer}</div>:<Panel core title="异常图片预览" tools={<Badge tone="amber">按实际异常值绘图</Badge>}>
 <div className="row">{trigger}<span className="muted">逐条查看数值偏差；有原始尺寸时同步绘制局部形态。</span></div>{viewer}</Panel>;
}
