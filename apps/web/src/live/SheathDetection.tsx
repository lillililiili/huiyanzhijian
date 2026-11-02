import {RecordFilterSwitch} from './RecordFilterSwitch';
import {startVisiblePolling} from '../shared/refreshPolicy';
import {useEffect,useMemo,useRef,useState} from 'react';
import {type ApiClient,type Task,type Measurement,environmentLabel,taskState,labelTime,specificationLabel} from './api';
import {readTaskTrend} from './taskTrend';
import {sheathAvailable,sheathStatus,sheathChartRows} from './sheathDisplay';
import {compactDecimal} from './detectionDisplay';
import {LiveTrend} from './Measurements';
import {SheathResult} from './SheathResult';
import {Panel} from '../ui/Panel';
import {Button} from '../ui/Button';
import {Badge} from '../ui/Badge';
import {Note} from '../ui/Note';
import {DataTable} from '../ui/DataTable';
import {Drawer} from '../ui/Drawer';
import {HashLink} from '../ui/HashLink';
import {csvCell,downloadFile} from '../ui/download';
import './detection-review.css';

export function SheathDetection({api,task}:{api:ApiClient;task:Task}){
 const [rows,setRows]=useState<Measurement[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[asOf,setAsOf]=useState<string>();
 const [follow,setFollow]=useState(task.state==='RUNNING'),[revision,setRevision]=useState(0),[filter,setFilter]=useState(''),[page,setPage]=useState(0),[size,setSize]=useState(25),[chosen,setChosen]=useState<Measurement|null>(null);
 useEffect(()=>setFollow(task.state==='RUNNING'),[task.state]);
 const following=useRef(follow);following.current=follow;
 useEffect(()=>{
  const controller=new AbortController();let active=true,inFlight=false,cache:Measurement[]=[];
  setRows([]);setLoaded(false);setError('');setAsOf(undefined);setPage(0);setChosen(null);
  async function load(){
   if(inFlight)return;inFlight=true;setBusy(true);
   try{const result=await readTaskTrend(api,task.id,cache,controller.signal);if(active){cache=result.rows;setRows(cache);setLoaded(true);setAsOf(result.asOf);setError('');}}
   catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:'读取失败');}
   finally{inFlight=false;if(active)setBusy(false);}
  }
  void load();const timer=task.state==='RUNNING'?startVisiblePolling(()=>{if(following.current)return load();},3000):null;
  return()=>{active=false;controller.abort();if(timer)timer();};
 },[api,task.id,task.state,revision]);
 const chartRows=useMemo(()=>sheathChartRows(rows),[rows]);
 const valid=rows.filter(sheathAvailable),latest=valid.at(-1);
 const min=valid.reduce<Measurement|undefined>((a,r)=>!a||Number(r.sheath_result!.value)<Number(a.sheath_result!.value)?r:a,undefined);
 const max=valid.reduce<Measurement|undefined>((a,r)=>!a||Number(r.sheath_result!.value)>Number(a.sheath_result!.value)?r:a,undefined);
 const selected=[...rows].reverse().filter(r=>!filter||(filter==='available'?sheathAvailable(r):filter==='unavailable'?!sheathAvailable(r):(r.sheath_result?.status||'NOT_PROVIDED')===filter));
 const pages=Math.max(1,Math.ceil(selected.length/size)),current=Math.min(page,pages-1),visible=selected.slice(current*size,(current+1)*size);
 const value=(r?:Measurement)=>r?compactDecimal(r.sheath_result?.value):'—';
 const time=(s:string)=>labelTime(s).replace(/ 北京时间$/,'');
 const pairText=(r:Measurement,k:string)=>String(r.sheath_result?.pair?.[k]??'—');
 function exportCsv(){
  const records=selected.map(r=>[r.id,task.task_code,task.current_spool_code||task.context_snapshot.spool_code,task.device_id,r.raw_payload.sample_time,r.received_at,sheathAvailable(r)?r.sheath_result!.value:null,'mm',sheathStatus(r),r.sheath_result?.reason||'未携带配对',pairText(r,'aMean'),pairText(r,'bMean'),pairText(r,'aAt'),pairText(r,'bAt'),pairText(r,'delayMs'),pairText(r,'syncRevision'),r.sheath_result?.method,r.sheath_result?.validation_version,r.raw_payload.data_environment,asOf]);
  downloadFile(`护套厚度-${task.task_code}.csv`,'\uFEFF'+[['记录ID','任务编号','盘号','设备','采样时间UTC','接收时间UTC','核对厚度','单位','配对状态','原因','A均径mm','B均径mm','A采样时间','B采样时间','补偿ms','配置版本','方法','核对版本','来源','快照截止UTC'],...records].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
 }
 return <>
  <div className="detection-overview">
   <section className="review-context" aria-label="任务与生产信息"><div className="review-context-heading"><div><span>检测任务</span><strong>{task.task_code}</strong></div><div className="review-context-badges"><Badge tone={task.state==='RUNNING'?'blue':'gray'}>{taskState[task.state]}</Badge><Badge tone="gray">{environmentLabel(task.data_environment)}</Badge></div></div><dl className="review-context-facts"><div><dt>当前盘号</dt><dd>{task.current_spool_code||task.context_snapshot.spool_code}</dd></div><div><dt>执行设备</dt><dd>{task.device_id}</dd></div><div><dt>工单编号</dt><dd>{task.current_order_code||task.context_snapshot.external_code}</dd></div><div><dt>线缆规格</dt><dd>{specificationLabel(task.context_snapshot.specification)}</dd></div></dl></section>
   <section className="review-kpis" aria-label="护套厚度关键结果">
    <div className="review-kpi review-kpi-primary"><span>最近有效厚度</span><div className="review-kpi-value"><strong title={latest?.sheath_result?.value||undefined}>{value(latest)}</strong><span>mm</span></div><small>{latest?labelTime(latest.raw_payload.sample_time):loaded?'暂无有效配对':'正在读取'}</small></div>
    <div className="review-kpi"><span>接收记录总数</span><div className="review-kpi-value"><strong>{loaded?rows.length:'—'}</strong><span>条</span></div><small>有效配对 {loaded?valid.length:'—'} 条 · 本任务完整记录</small></div>
    <div className="review-kpi"><span>最小厚度</span><div className="review-kpi-value"><strong>{value(min)}</strong><span>mm</span></div><small>{min?<button className="sheath-locate-btn" onClick={()=>setChosen(min)}>查看对应记录 →</button>:'暂无有效配对'}</small></div>
    <div className="review-kpi"><span>最大厚度</span><div className="review-kpi-value"><strong>{value(max)}</strong><span>mm</span></div><small>{max?<button className="sheath-locate-btn" onClick={()=>setChosen(max)}>查看对应记录 →</button>:'暂无有效配对'}</small></div>
   </section>
   {error&&<Note><span role="alert">护套记录读取失败：{error}。{loaded?'保留上次完整快照。':'尚未取得完整数据。'}</span><Button onClick={()=>setRevision(v=>v+1)}>重新加载</Button></Note>}
   <section className="review-main-grid">
    <Panel core className="review-trend-panel" title={task.state==='RUNNING'?'护套厚度实时趋势':'护套厚度趋势回看'} tools={<><span className="review-scope-tag">{loaded?`完整任务趋势 · ${rows.length}条`:'完整趋势载入中'}</span>{task.state==='RUNNING'&&<Button onClick={()=>setFollow(v=>!v)}>{follow?'暂停自动刷新':'继续自动刷新'}</Button>}<Button disabled={busy} onClick={()=>setRevision(v=>v+1)}>刷新</Button></>}>
     <div className="review-range"><span>有效厚度范围</span><strong>{value(min)} <span>—</span> {value(max)} <small>mm</small></strong><span className="review-range-scope">本任务完整记录</span></div>
     <LiveTrend rows={chartRows} unit="mm" onSelect={r=>setChosen(rows.find(original=>original.id===r.id)||null)} showFailures={false}/>
     {rows.length>0&&<p className="review-footnote" aria-label="完整趋势采样范围">{labelTime(rows[0].raw_payload.sample_time)} → {labelTime(rows[rows.length-1].raw_payload.sample_time)}</p>}
     <p className="review-footnote">从首条到末条采样；未配对、校验失败和隔离记录留空，不补零。{asOf&&<>快照：{labelTime(asOf)}</>}</p>
    </Panel>
    <Panel core className="review-judgment-panel" title="配对概况" tools={<span className="review-scope-tag">本任务完整记录</span>}>
     <div className="review-results" aria-label="护套配对统计">{[['有效配对',valid.length,'pass'],['不可用记录',rows.length-valid.length,'fail'],['未携带配对',rows.filter(r=>!r.sheath_result||r.sheath_result.status==='NOT_PROVIDED').length,'not_evaluated']].map(([name,count,tone])=><div className={`review-result-row review-result-${tone}`} key={name}><span><i/>{name}</span><strong>{loaded?count:'—'}<small> 条</small></strong></div>)}</div>
     <p className="review-footnote">未携带配对属于不可用记录；配对核对通过不等于质量合格。</p>
     <div className="review-latest-failure"><span className="review-section-label">护套质量判定</span><p>未配置护套质量限值</p><p>本页展示中心核对后的 A 均径 − B 均径；保留零值及负值。</p></div>
     {latest&&<div className="review-latest-failure"><span className="review-section-label">最近配对依据</span><p>出口 A：{pairText(latest,'aMean')} mm</p><p>入口 B：{pairText(latest,'bMean')} mm</p><p>时间补偿：{pairText(latest,'delayMs')} ms</p><Button onClick={()=>setChosen(latest)}>查看配对详情</Button></div>}
    </Panel>
   </section>
  </div>
  <Panel core table className="detection-record-panel" title="护套厚度记录" tools={<>
   <RecordFilterSwitch label="护套配对状态筛选" value={filter&&filter!=='available'?'unavailable':filter} disabled={busy} onChange={value=>{setFilter(value);setPage(0);}} options={[
    {value:'',label:'全部记录'},
    {value:'unavailable',label:'不可用记录',tone:'fail',count:loaded?rows.length-valid.length:undefined},
    {value:'available',label:'有效配对',tone:'pass'},
   ]}/>
   <span className="muted">{busy?'正在查询…':`第${current+1}页 · ${visible.length}条`}</span>
   <Button disabled={busy} onClick={()=>setRevision(v=>v+1)}>刷新查询</Button>
   <Button disabled={!loaded||busy||!!error||!selected.length} onClick={exportCsv}>导出筛选记录 CSV</Button>
  </>}>
   {filter&&filter!=='available'&&<div className="row measurement-pagination"><label className="muted small">不可用原因 <select aria-label="护套配对筛选" disabled={busy} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="unavailable">全部不可用原因</option><option value="INVALID">配对校验失败</option><option value="UNAVAILABLE">未完成配对</option><option value="NOT_PROVIDED">未携带配对</option></select></label></div>}
   <DataTable headers={['采样时间（北京时间）','接收时间（北京时间）','护套厚度 / mm','A / B 均径 / mm','配对状态','数据来源','操作']} emptyText={error?'数据读取失败，请重试':!loaded?'正在读取完整记录…':'当前筛选范围没有记录'} rows={visible.map(r=>[time(r.raw_payload.sample_time),time(r.received_at),sheathAvailable(r)?value(r):'—',`${pairText(r,'aMean')} / ${pairText(r,'bMean')}`,<Badge tone={sheathAvailable(r)?'green':r.sheath_result?.status==='INVALID'?'red':'gray'}>{sheathStatus(r)}</Badge>,environmentLabel(r.raw_payload.data_environment),<Button onClick={()=>setChosen(r)}>详情</Button>])}/>
   <div className="row measurement-pagination">
    <Button disabled={current===0||busy} onClick={()=>setPage(current-1)}>上一页</Button><Button disabled={current+1>=pages||busy||!!error} onClick={()=>setPage(current+1)}>下一页</Button>
    <span className="muted small">第 {current+1} / {pages} 页 · 共 {selected.length} 条</span>
    {filter&&<span className={`filter-active-note${filter==='available'?' filter-active-pass':''}`}>已筛选：{filter==='available'?'有效配对':filter==='INVALID'?'配对校验失败':filter==='UNAVAILABLE'?'未完成配对':filter==='NOT_PROVIDED'?'未携带配对':'不可用记录'}（非质量判定）</span>}
    <label className="muted small">每页显示 <select aria-label="每页显示条数" value={size} disabled={busy} onChange={e=>{setSize(Number(e.target.value));setPage(0);}}>{[25,50,100].map(n=><option key={n} value={n}>{n} 条</option>)}</select></label>
   </div>
  </Panel>
  <Drawer title="护套厚度记录详情" open={!!chosen} onClose={()=>setChosen(null)}>{chosen&&<><p>任务：{task.task_code} · {task.device_id}</p><p>盘号：{chosen.business_context?.spool_code||task.current_spool_code||task.context_snapshot.spool_code}</p><p>采样时间：{labelTime(chosen.raw_payload.sample_time)}</p><p>接收时间：{labelTime(chosen.received_at)}</p><p>记录状态：{sheathStatus(chosen)} · {chosen.receipt_status}</p>{chosen.sheath_result?<SheathResult result={chosen.sheath_result}/>:<Note>本条历史记录未携带护套配对数据。</Note>}<details className="ux-technical"><summary>原始记录与核对结果</summary><p>记录ID：{chosen.id}</p><pre className="b2-json">{JSON.stringify({raw_payload:chosen.raw_payload,sheath_result:chosen.sheath_result},null,2)}</pre></details><HashLink route={`task?id=${task.id}&back=${encodeURIComponent('detection?metric=ht&task='+task.id)}`}>任务详情</HashLink></>}</Drawer>
 </>;
}
