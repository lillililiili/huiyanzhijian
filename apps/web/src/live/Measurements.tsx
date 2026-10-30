import {DefectExamples, DefectExampleViewer} from './DefectExamples';
import {compactDecimal, detectionLimit} from './detectionDisplay';
import {detectionTrendOption} from './detectionTrend';
import {sortBySampleTime, compareSampleTime} from './sampleTime';
import './detection-review.css';
import {AdvancedFilters,DateTimeField,ScopedOptions} from "./UxFields";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { PageTitle } from "../ui/PageTitle";
import { Panel } from "../ui/Panel";
import { DataTable } from "../ui/DataTable";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Note } from "../ui/Note";
import { Drawer } from "../ui/Drawer";
import { HashLink } from "../ui/HashLink";

import { csvCell, downloadFile } from "../ui/download";
import { navigate } from "../app/hashRoute";
import { environmentLabel, codes, names, quality, taskState, ruleText, labelTime, type Rule, type ApiClient, type Measurement, type Page, type Task, type Workspace } from "./api";
import { compareDecimal } from "./defectMatch";

export function LiveTrend({ rows, unit, onSelect, rule }: { rows: Measurement[]; unit: string; onSelect: (r: Measurement) => void; rule?: Rule }) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const chart = echarts.init(host.current); instance.current = chart;
    const resize=()=>chart.resize();
    const observer=typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(host.current);window.addEventListener("resize",resize);
    return()=>{observer?.disconnect();window.removeEventListener("resize",resize);chart.dispose();instance.current=null;};
  },[]);
  useEffect(()=>{
    const chart=instance.current;if(!chart)return;
    const points=sortBySampleTime(rows);
    chart.setOption(detectionTrendOption(points,unit,rule));
    const select=(event: unknown)=>{const e=event as {componentType?:string;dataIndex?:number};if(e.componentType==='series'&&e.dataIndex!==undefined&&points[e.dataIndex])onSelect(points[e.dataIndex]);};
    chart.on('click',select);return()=>{if(typeof chart.off==='function')chart.off('click',select);};
  },[rows,unit,onSelect,rule]);
  return <div className="review-chart"><div className="review-chart-toolbar"><span className="review-scope-tag">采样时间 · 北京时间</span><div className="review-chart-legend"><span>检测值</span><span className="is-fail">超限点</span></div><button type="button" className="review-chart-reset" onClick={()=>instance.current?.dispatchAction({type:'dataZoom',start:0,end:100})}>恢复全局</button></div><div ref={host} className="chart-host" style={{height:350}} role="img" aria-label="检测趋势，点击点查看原始记录，下方全局轴可拖动缩放"/><p className="review-zoom-hint">全局范围 <span>拖动下方滑块或两侧手柄，查看局部趋势</span></p></div>;
}

function MetricSchematic({metric}:{metric:string}){
  if(metric==="OVALITY")return <svg className="review-schematic" viewBox="0 0 520 250" role="img" aria-label="电缆截面X向和Y向测量示意">
    <defs><linearGradient id="ovality-core" x1="0" x2="1"><stop stopColor="#d9e4f2"/><stop offset="1" stopColor="#f5f8fc"/></linearGradient><marker id="ovality-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="none" stroke="#2464b7" strokeWidth="1.4"/></marker></defs>
    <rect x="0" y="0" width="520" height="250" rx="12" fill="#f7faff"/><circle cx="260" cy="122" r="82" fill="#18324e"/><circle cx="260" cy="122" r="66" fill="url(#ovality-core)" stroke="#aac0dc" strokeWidth="2"/><circle cx="260" cy="122" r="39" fill="#b77b3d" stroke="#8d5b2d" strokeWidth="3"/>
    {Array.from({length:14},(_,i)=><circle key={i} cx={232+(i%5)*14} cy={101+Math.floor(i/5)*14} r="4" fill="#e5b66f" stroke="#875d31"/>)}
    <line x1="178" y1="224" x2="342" y2="224" stroke="#2464b7" strokeWidth="2" markerStart="url(#ovality-arrow)" markerEnd="url(#ovality-arrow)"/><line x1="370" y1="40" x2="370" y2="204" stroke="#2464b7" strokeWidth="2" markerStart="url(#ovality-arrow)" markerEnd="url(#ovality-arrow)"/><text x="260" y="244" textAnchor="middle" fill="#315272" fontSize="13">X向两点距离 (0°—180°)</text><text x="393" y="125" fill="#315272" fontSize="13" transform="rotate(90 393 125)">Y向两点距离 (90°—270°)</text>
  </svg>;
  if(metric==="WIRE_GAP")return <svg className="review-schematic" viewBox="0 0 520 250" role="img" aria-label="相邻铜丝间隙测量示意">
    <defs><linearGradient id="wire-copper" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#f4c27f"/><stop offset=".45" stopColor="#b66d35"/><stop offset="1" stopColor="#7c4827"/></linearGradient><marker id="gap-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="none" stroke="#2464b7" strokeWidth="1.4"/></marker></defs>
    <rect x="0" y="0" width="520" height="250" rx="12" fill="#f7faff"/><rect x="34" y="47" width="452" height="156" rx="14" fill="#22384c"/>
    {[0,1,2,3,4,5,6].map(i=><g key={i}><path d={`M${75+i*58} 64L${135+i*58} 186`} stroke="url(#wire-copper)" strokeWidth="19" strokeLinecap="round"/><path d={`M${72+i*58} 64L${132+i*58} 186`} stroke="#f7d29c" strokeWidth="2" opacity=".72"/></g>)}
    <line x1="184" y1="118" x2="211" y2="118" stroke="#e65353" strokeWidth="2" markerStart="url(#gap-arrow)" markerEnd="url(#gap-arrow)"/><text x="198" y="102" textAnchor="middle" fill="#fff" fontSize="13">间隙位置示意</text><text x="260" y="229" textAnchor="middle" fill="#315272" fontSize="13">相邻铜丝间距 · 仅作检测对象说明</text>
  </svg>;
  return <svg className="review-schematic" viewBox="0 0 520 250" role="img" aria-label="金属屏蔽带搭盖区域测量示意">
    <defs><linearGradient id="shield-wrap" x1="0" x2="1"><stop stopColor="#7f4c2f"/><stop offset=".3" stopColor="#d89b61"/><stop offset=".58" stopColor="#f0c18b"/><stop offset="1" stopColor="#955b36"/></linearGradient><marker id="overlap-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse"><path d="M0 0L8 4L0 8" fill="none" stroke="#2464b7" strokeWidth="1.4"/></marker></defs>
    <rect x="0" y="0" width="520" height="250" rx="12" fill="#f7faff"/><rect x="42" y="64" width="436" height="126" rx="62" fill="#263b51"/><path d="M70 83 Q142 53 214 83 L265 171 Q193 200 121 171Z" fill="url(#shield-wrap)" stroke="#9b673f" strokeWidth="2"/><path d="M214 83 Q286 53 358 83 L409 171 Q337 200 265 171Z" fill="url(#shield-wrap)" stroke="#9b673f" strokeWidth="2"/><path d="M214 83 L265 171" stroke="#fff0d6" strokeWidth="5" opacity=".9"/><line x1="224" y1="105" x2="252" y2="149" stroke="#2464b7" strokeWidth="2" markerStart="url(#overlap-arrow)" markerEnd="url(#overlap-arrow)"/><text x="272" y="127" fill="#315272" fontSize="13">搭盖区域示意</text><text x="260" y="225" textAnchor="middle" fill="#315272" fontSize="13">金属屏蔽带的覆盖与搭接位置</text>
  </svg>;
}

export function Measurements({ api, data, task, params, live = false }: {api:ApiClient;data:Workspace;task?:Task;params:URLSearchParams;live?:boolean}) {
  const [pages,setPages]=useState<Page<Measurement>[]>([]),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [chosen,setChosen]=useState<Measurement|null>(null),[following,setFollowing]=useState(live&&task?.state==="RUNNING"),[exporting,setExporting]=useState(false);
  const [pageSize,setPageSize]=useState(()=>{const requested=Number(params.get("limit")||"25");return [25,50,100].includes(requested)?requested:25;});
  const [chartRows,setChartRows]=useState<Measurement[]>([]),[chartError,setChartError]=useState(""),[chartLoaded,setChartLoaded]=useState(false);
  const [showFailures,setShowFailures]=useState(false);
  const [qualityFilter, setQualityFilter]=useState<string>(()=>params.get("quality")||"");
  const [taskTotal,setTaskTotal]=useState<number|undefined>();
  const search=new URLSearchParams({limit:String(pageSize),order:"desc"});
  const selectedSpool=params.get("spool")||"";
  if(task) {
    search.set("task_id",task.id);
    if(qualityFilter) search.set("quality", qualityFilter);
  } else {
    for(const key of ["task_id","metric_code","device_id","from","to","quality","environment","process_id","data_status","receipt_status"]) {
      if(params.get(key)) search.set(key,params.get(key)!);
    }
    if(qualityFilter) search.set("quality", qualityFilter);
  }
  if(selectedSpool&&!task)search.set("spool_id",selectedSpool);
  const url=`/measurements?${search}`;
  const chartSearch=new URLSearchParams({limit:"100",order:"desc",task_id:task?.id||""});
  const chartUrl=`/measurements?${chartSearch}`;
  const generation=useRef(0);
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();let active=true,inFlight=false;generation.current++;setPages([]);setIndex(0);setChosen(null);setError("");setExporting(false);
    async function load(){
      if(inFlight)return;
      inFlight=true;setBusy(true);
      try{
        const totalQuery=new URLSearchParams({limit:"1",order:"desc",task_id:task?.id||""});
        const [page,totalPage]=await Promise.all([
          api.request<Page<Measurement>>(url,undefined,{},controller.signal),
          live&&task&&qualityFilter ? api.request<Page<Measurement>>(`/measurements?${totalQuery}`,undefined,{},controller.signal) : Promise.resolve(null),
        ]);
        if(active){setPages([page]);setTaskTotal((totalPage||page).total);setIndex(0);setError("");}
      }
      catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:"查询失败");}
      finally{inFlight=false;if(active)setBusy(false);}
    }
    void load();const timer=live&&following&&task?.state==="RUNNING"?setInterval(()=>void load(),3000):null;
    return()=>{active=false;generation.current++;controller.abort();if(timer)clearInterval(timer);};
  },[api,url,live,following,reload,task?.state,task?.id,qualityFilter]);
  const page=pages[index],rows=page?.items||[];
  useEffect(()=>{
    if(!live||!task||task.state==="RUNNING"){setChartRows([]);setChartError("");setChartLoaded(false);return;}
    const controller=new AbortController();let active=true;
    setChartRows([]);setChartError("");setChartLoaded(false);
    async function loadChartHistory(){
      try{
        let result=await api.request<Page<Measurement>>(chartUrl,undefined,{},controller.signal),all=[...result.items];
        while(result.has_more&&result.next_cursor){result=await api.request<Page<Measurement>>(`${chartUrl}&cursor=${encodeURIComponent(result.next_cursor)}`,undefined,{},controller.signal);all.push(...result.items);}
        if(active){setChartRows(all);setChartError("");setChartLoaded(true);}
      }catch(e){if(active&&!controller.signal.aborted){setChartError(e instanceof Error?e.message:"完整检测趋势读取失败");setChartLoaded(false);}}
    }
    void loadChartHistory();
    return()=>{active=false;controller.abort();};
  },[api,chartUrl,live,task?.id,task?.state,reload]);
  async function next(){
    if(!page?.next_cursor||busy)return;const gen=generation.current;setBusy(true);
    try{if(pages[index+1])setIndex(index+1);else{const result=await api.request<Page<Measurement>>(`${url}&cursor=${encodeURIComponent(page.next_cursor)}`);if(gen===generation.current){setPages([...pages,result]);setIndex(index+1);}}if(gen===generation.current)setError("");}
    catch(e){if(gen===generation.current)setError((e as Error).message);}finally{if(gen===generation.current)setBusy(false);}
  }
  async function exportAll(format:"csv"|"json"){
    if(!pages[0]||exporting||error)return;const gen=generation.current;setExporting(true);
    try{
      let p=pages[0];const all=[...p.items];
      while(p.has_more&&p.next_cursor){p=await api.request<Page<Measurement>>(`${url}&cursor=${encodeURIComponent(p.next_cursor)}`);if(gen!==generation.current)return;all.push(...p.items);}
      if(gen!==generation.current)return;
      const base=`慧眼智检-${task?.id||"历史"}-${Date.now()}`;
      if(format==="json")downloadFile(base+".json",JSON.stringify({as_of:pages[0].as_of,filters:Object.fromEntries(search),scope:pages[0].scope,records:all},null,2),"application/json");
      else{
        const headers=["记录ID","任务ID","任务编号","查询时关联盘号","创建时盘号","关联版本","查询时工单","设备","指标","采样时间UTC","来源米数","原始值","单位","有效性","判定","判定原因","环境","位置资格","接收时间UTC","快照截止UTC"];
        const lines=all.map(r=>{const t=data.tasks.find(t=>t.id===r.raw_payload.task_id);return [r.id,r.raw_payload.task_id,r.business_context?.task_code||t?.task_code,r.business_context?.spool_code||(pages[0]?.scope?.members||data.spools).find(s=>s.id===t?.spool_id)?.spool_code,r.business_context?.original_spool_code||t?.context_snapshot?.spool_code,r.business_context?.association_version,r.business_context?.external_code,r.raw_payload.device_id,names[r.metric_code],r.raw_payload.sample_time,r.raw_payload.position_m,r.value,r.unit,r.raw_payload.data_status,r.quality_result,r.evaluation_reason,r.raw_payload.data_environment,r.position_eligibility,r.received_at,pages[0].as_of];});
        downloadFile(base+".csv","\uFEFF"+[headers,...lines].map(row=>row.map(csvCell).join(",")).join("\r\n"),"text/csv;charset=utf-8");
      }
    }catch(e){if(gen===generation.current)setError((e as Error).message);}finally{if(gen===generation.current)setExporting(false);}
  }
  const latest=rows[0],initialLoading=busy&&!page;
  const summaryReady=!initialLoading&&(task?.state==="RUNNING"||!task||chartLoaded);
  const summaryRows=task?.state==="RUNNING"?rows:task?chartRows:rows;
  const summaryScope=task?.state==="RUNNING"?"当前页":task?"本任务完整记录":"当前查询范围";
  const samplingCounts={
    valid:summaryRows.filter(r=>r.raw_payload.data_status==="VALID").length,
    invalid:summaryRows.filter(r=>r.raw_payload.data_status==="INVALID").length,
    missing:summaryRows.filter(r=>r.raw_payload.data_status==="MISSING").length,
    quarantined:summaryRows.filter(r=>r.receipt_status==="QUARANTINED").length,
  };
  const qualityCounts={
    PASS:summaryRows.filter(r=>r.quality_result==="PASS").length,
    FAIL:summaryRows.filter(r=>r.quality_result==="FAIL").length,
    NOT_EVALUATED:summaryRows.filter(r=>r.quality_result==="NOT_EVALUATED").length,
  };
  const storedValid=summaryRows.filter(r=>r.raw_payload.data_status==="VALID"&&r.receipt_status==="STORED");
  const measuredValues=storedValid.filter(r=>r.value!==null&&compareDecimal(r.value,r.value)!==null);
  const smallestMeasured=measuredValues.reduce<Measurement|null>((found,r)=>{if(!found)return r;const compared=compareDecimal(r.value,found.value);return compared!==null&&compared<0?r:found;},null);
  const largestMeasured=storedValid.filter(r=>r.value!==null&&compareDecimal(r.value,r.value)!==null).reduce<Measurement|null>((found,r)=>{
    if(!found)return r;
    const compared=compareDecimal(r.value,found.value);
    return compared!==null&&compared>0?r:found;
  },null);
  const newestMeasured=measuredValues.reduce<Measurement|null>((found,r)=>!found||compareSampleTime(r,found)>0?r:found,null);
  const recentFailure=measuredValues.filter(r=>r.quality_result==='FAIL').reduce<Measurement|null>((found,r)=>!found||compareSampleTime(r,found)>0?r:found,null);
  const overviewReady=summaryReady&&!error;
  const metricUnit=newestMeasured?.unit||latest?.unit||(task?.metric_code==='WIRE_GAP'?'mm':'%');
  const returnTo=params.get("return_to")?.startsWith("detection?")?params.get("return_to"):null;
  const selectedTask=data.tasks.find(t=>t.id===params.get("task_id"));
  return <>
    {!live&&<PageTitle title="历史检测数据" subtitle="服务端快照分页 · 原始小数与时间保留 · 盘号为查询时归属" actions={returnTo?<HashLink route={returnTo}>返回检测</HashLink>:selectedSpool?<HashLink route={`trace?spool=${selectedSpool}`}>返回线缆详情</HashLink>:undefined} />}
    {!live&&<form key={params.toString()} className="filters" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const q=new URLSearchParams();for(const [k,v]of form){if(String(v)){q.set(k,String(v));}}q.set("limit",String(pageSize));if(returnTo)q.set("return_to",returnTo);navigate(`history?${q}`);}}>
      <Field label="线缆"><select name="spool" defaultValue={selectedSpool}><option value="">全部线缆</option>{selectedSpool&&!data.spools.some(s=>s.id===selectedSpool)&&<option value={selectedSpool}>{selectedSpool}（待核对）</option>}{data.spools.filter(s=>!selectedTask||s.id===selectedTask.spool_id||s.id===selectedSpool||s.canonical_spool_id===selectedTask.spool_id).map(s=><option key={s.id} value={s.id}>{s.spool_code} · {data.orders.find(o=>o.id===s.work_order_id)?.external_code}</option>)}</select></Field>
      <Field label="任务"><select name="task_id" defaultValue={params.get("task_id")||""}><option value="">全部任务</option>{params.get("task_id")&&!data.tasks.some(t=>t.id===params.get("task_id"))&&<option value={params.get("task_id")!}>{params.get("task_id")}（待核对）</option>}{data.tasks.map(t=><option key={t.id} value={t.id}>{data.spools.find(s=>s.id===t.spool_id)?.spool_code||t.context_snapshot?.spool_code} · {names[t.metric_code]} · {t.task_code||t.id.slice(0,8)}</option>)}</select></Field>
      <Field label="检测项"><select name="metric_code" defaultValue={params.get("metric_code")||""}><option value="">全部项目</option><ScopedOptions selected={params.get("metric_code")} options={Object.values(codes).filter(c=>!selectedTask||c===selectedTask.metric_code).map(c=>({id:c,label:names[c]}))}/></select></Field>
      <Field label="设备"><select name="device_id" defaultValue={params.get("device_id")||""}><option value="">全部设备</option><ScopedOptions selected={params.get("device_id")} options={data.catalog.device.filter(d=>selectedTask?d.id===selectedTask.device_id:!params.get("metric_code")||d.metric_code===params.get("metric_code")).map(d=>({id:d.id,label:d.id}))}/></select></Field>
      <AdvancedFilters params={params} keys={["process_id","data_status","receipt_status","from","to","quality","environment"]}><Field label="工序"><select name="process_id" defaultValue={params.get("process_id")||""}><option value="">全部工序</option><ScopedOptions selected={params.get("process_id")} options={data.catalog.inspection_process.filter(p=>!selectedTask||p.id===selectedTask.process_id).map(p=>({id:p.id,label:p.name}))}/></select></Field>
      <Field label="数据有效性"><select name="data_status" defaultValue={params.get("data_status")||""}><option value="">全部有效性</option><option value="VALID">有效</option><option value="INVALID">无效</option><option value="MISSING">缺测</option></select></Field>
      <Field label="接收状态"><select name="receipt_status" defaultValue={params.get("receipt_status")||""}><option value="">全部接收状态</option><option value="STORED">已存储</option><option value="QUARANTINED">隔离</option></select></Field>
      <DateTimeField name="from" label="开始时间（含）" value={params.get("from")}/><DateTimeField name="to" label="结束时间（不含）" value={params.get("to")}/>
      <Field label="判定"><select name="quality" defaultValue={params.get("quality")||""}><option value="">全部判定</option>{Object.entries(quality).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="数据来源"><select name="environment" defaultValue={params.get("environment")||""}><option value="">全部来源</option><option>SIMULATED</option><option>REAL</option></select></Field>
      </AdvancedFilters><Button primary type="submit">查询</Button><HashLink route={returnTo?"history?return_to="+encodeURIComponent(returnTo):"history"}>清空筛选</HashLink>
    </form>}
    {!live&&selectedTask&&<Note>当前任务：{selectedTask.task_code} · {selectedTask.device_id} · {names[selectedTask.metric_code]}；其余条件取交集。</Note>}
    {error&&<Note><span role="alert">查询失败，原列表未更新：{error}</span></Note>}
    {pages[0]?.scope&&<Note>本次范围：主盘 {pages[0].scope.members.find(s=>s.id===pages[0].scope!.root_id)?.spool_code} · {pages[0].scope.members.length}个身份 · {pages[0].scope.task_count}个关联任务；筛选条件取交集。归并、改号、任务更正或任务集合变化后请刷新查询。</Note>}
    {live&&<div className="detection-overview">
      {showFailures&&task&&<DefectExampleViewer timeOnly api={api} task={task} context={`任务 ${task.task_code}`} onClose={()=>setShowFailures(false)}/>}
      {task&&<section className="review-context" aria-label="任务与生产信息">
        <div className="review-context-heading"><div><span>检测任务</span><strong>{task.task_code}</strong></div><div className="review-context-badges"><Badge tone={task.state==='RUNNING'?'blue':'gray'}>{taskState[task.state]||task.state}</Badge><Badge tone="gray">{environmentLabel(task.data_environment)}</Badge></div></div>
        <dl className="review-context-facts"><div><dt>当前盘号</dt><dd>{task.current_spool_code||data.spools.find(s=>s.id===task.spool_id)?.spool_code||task.context_snapshot?.spool_code||'—'}</dd></div><div><dt>执行设备</dt><dd>{task.device_id}</dd></div><div><dt>工单编号</dt><dd>{task.current_order_code||data.orders.find(o=>o.id===task.work_order_id)?.external_code||task.context_snapshot?.external_code||'—'}</dd></div><div><dt>线缆规格</dt><dd>{compactDecimal(task.context_snapshot?.specification?.voltage_kv)} kV · {compactDecimal(task.context_snapshot?.specification?.conductor_area_mm2)} mm² · {task.context_snapshot?.specification?.core_count??'—'}芯</dd></div></dl>
      </section>}
      <section className="review-kpis" aria-label="检测关键结果">
        <div className="review-kpi review-kpi-primary"><span>最近有效值</span><div className="review-kpi-value" title={newestMeasured?`${newestMeasured.value} ${newestMeasured.unit}`:undefined}><strong>{overviewReady?compactDecimal(newestMeasured?.value):'—'}</strong><span>{metricUnit}</span></div><small>{overviewReady&&newestMeasured?labelTime(newestMeasured.raw_payload.sample_time):overviewReady?'暂无有效采样':'等待记录读取'}</small></div>
        <div className="review-kpi"><span>接收记录总数</span><div className="review-kpi-value"><strong>{error||initialLoading?'—':taskTotal??'—'}</strong><span>条</span></div><small>本任务累计接收 · 不随筛选和翻页改变</small></div>
        <div className={'review-kpi review-kpi-failure'+(overviewReady&&qualityCounts.FAIL>0?' has-failures':'')}><span>超限记录</span><div className="review-kpi-value"><strong>{overviewReady?qualityCounts.FAIL:'—'}</strong><span>条</span></div><small>{summaryScope} · 按采样记录计数</small></div>
        <div className="review-kpi review-kpi-rule"><span>判定限值 <em>{task?.rule_snapshot.approval_state==='TEST_ONLY'?'测试规则':'任务规则'}</em></span><div className="review-kpi-value"><strong title={task?ruleText(task.rule_snapshot):undefined}>{detectionLimit(task?.rule_snapshot,metricUnit)}</strong></div><small>任务创建时冻结 · 方法版本 {task?.rule_snapshot.method_version||'—'}</small></div>
      </section>
      <section className="review-main-grid">
        <Panel core className="review-trend-panel" title={task?.state==='RUNNING'?'实时检测趋势':'检测趋势回看'} tools={<><span className="review-scope-tag">{task?.state==='RUNNING'?'当前页趋势':chartError?'当前页预览':chartLoaded?'完整任务趋势':'完整趋势载入中'}</span>{task?.state==='RUNNING'?<Button onClick={()=>setFollowing(!following)}>{following?'暂停自动刷新':'继续自动刷新'}</Button>:<Button disabled={busy} onClick={()=>setReload(reload+1)}>刷新</Button>}</>}>
          <div className="review-range"><span>有效值范围</span><strong title={overviewReady?`${smallestMeasured?.value??'—'} ～ ${largestMeasured?.value??'—'} ${metricUnit}`:undefined}>{overviewReady?compactDecimal(smallestMeasured?.value):'—'} <span>—</span> {overviewReady?compactDecimal(largestMeasured?.value):'—'} <small>{metricUnit}</small></strong><span className="review-range-scope">{summaryScope}</span></div>
          {chartError&&<Note>完整趋势读取失败：{chartError}。当前仅展示已读取的列表记录。</Note>}
          <LiveTrend rows={task?.state==='RUNNING'?rows:chartRows.length?chartRows:rows} unit={metricUnit} onSelect={setChosen} rule={task?.rule_snapshot}/>
          <p className="review-footnote">按采样时间查看趋势；点击采样点查看原始记录。</p>
        </Panel>
        <Panel core className="review-judgment-panel" title="判定概况" tools={<span className="review-scope-tag">{summaryScope}</span>}>
          <div className="review-results" aria-label="服务端判定统计">{[['PASS','符合当前规则'],['FAIL','超限'],['NOT_EVALUATED','未判定']].map(([key,label])=><div className={`review-result-row review-result-${key.toLowerCase()}`} key={key}><span><i/>{label}</span><strong>{overviewReady?qualityCounts[key as keyof typeof qualityCounts]:'—'}<small> 条</small></strong></div>)}</div>
          <p className="review-footnote">{overviewReady?'未判定记录单列，不计作符合规则。':error||chartError?'记录读取失败，请刷新重试。':'正在读取完整检测记录…'}</p>
          <div className="review-latest-failure">
            <span className="review-section-label">最近超限</span>
            {overviewReady&&recentFailure?<><button type="button" className="review-failure-record" onClick={()=>setChosen(recentFailure)}><strong title={`${recentFailure.value} ${recentFailure.unit}`}>{compactDecimal(recentFailure.value)} <small>{recentFailure.unit}</small></strong><span>查看记录 →</span></button><p>{labelTime(recentFailure.raw_payload.sample_time)}</p><p>接收：{labelTime(recentFailure.received_at)}</p></>:<p>{overviewReady?'当前范围暂无有效已存储的超限记录。':'记录读取后展示。'}</p>}
            {overviewReady&&qualityCounts.FAIL>0&&task&&<Button onClick={()=>setShowFailures(true)}>查看超限记录与图片</Button>}
          </div>
          <div className="review-sampling-line"><span>有效 <b>{overviewReady?samplingCounts.valid:'—'}</b></span><span>无效 <b>{overviewReady?samplingCounts.invalid:'—'}</b></span><span>缺测 <b>{overviewReady?samplingCounts.missing:'—'}</b></span><span>隔离 <b>{overviewReady?samplingCounts.quarantined:'—'}</b></span></div>
          <details className="review-object-help"><summary>检测对象示意 <span>非现场实拍</span></summary><MetricSchematic metric={task?.metric_code||latest?.metric_code||'SHIELD_OVERLAP_RATE'}/><p className="review-footnote">仅说明检测对象，不关联当前记录或参与判定。</p></details>
        </Panel>
      </section>
      <details className="review-data-help"><summary>数据口径与规则说明</summary><p>总条数取服务端本任务累计接收数量；{summaryScope}用于有效性、判定和极值统计。未判定不等于符合。数字仅去除末尾零，原始精度保留在记录详情中。{task?ruleText(task.rule_snapshot):''}。采样时间为检测发生时间，接收时间为平台入库时间；不按米数或送料速度换算。</p></details>
    </div>}
    <Panel core table className="detection-record-panel" title={live?(task?.state==='ENDED'||task?.state==='CANCELLED'?'检测记录回看':'当前页测量记录'):"测量明细"} tools={<>
      <div className="review-filter-switch" role="group" aria-label="判定状态筛选">
        <button
          type="button"
          aria-pressed={qualityFilter === ""}
          disabled={busy}
          onClick={() => { setQualityFilter(""); setIndex(0); }}
        >
          全部记录
        </button>
        <button
          type="button"
          className="filter-fail"
          aria-pressed={qualityFilter === "FAIL"}
          disabled={busy}
          onClick={() => { setQualityFilter("FAIL"); setIndex(0); }}
        >
          <i className="filter-dot is-fail" />
          仅超限项
          {overviewReady && qualityCounts.FAIL > 0 ? <span className="filter-count">{qualityCounts.FAIL}</span> : null}
        </button>
        <button
          type="button"
          className="filter-pass"
          aria-pressed={qualityFilter === "PASS"}
          disabled={busy}
          onClick={() => { setQualityFilter("PASS"); setIndex(0); }}
        >
          <i className="filter-dot is-pass" />
          符合规则
        </button>
      </div>
      <span className="muted">{busy?"正在查询…":`第${index+1}页 · ${rows.length}条`}</span>
      <Button disabled={busy} onClick={()=>setReload(reload+1)}>刷新查询</Button>
      {!live&&<><Button disabled={exporting||!pages.length||busy||!!error} onClick={()=>void exportAll("csv")}>{exporting?"导出中…":"导出完整筛选CSV"}</Button><Button disabled={exporting||!pages.length||busy||!!error} onClick={()=>void exportAll("json")}>导出原始JSON</Button></>}
    </>}>
      {initialLoading?<Note>正在读取测量记录…</Note>:error?<Note>筛选查询失败，请点击“刷新查询”重试。</Note>:<DataTable headers={["采样时间（北京时间）","任务 / 线缆","设备 / 指标",live?"接收时间（北京时间）":"来源米数","值 / 单位","有效性 / 判定","来源","操作"]} emptyText={qualityFilter === "FAIL" ? "当前范围没有服务端判定为超限的记录；曲线波动不等于超限" : qualityFilter === "PASS" ? "当前无符合规则记录" : "未找到符合条件的记录"} rows={rows.map(r=>{const t=data.tasks.find(t=>t.id===r.raw_payload.task_id);return [live?labelTime(r.raw_payload.sample_time).replace(/ 北京时间$/,''):labelTime(r.raw_payload.sample_time),<><HashLink route={`task?id=${r.raw_payload.task_id}&back=${encodeURIComponent((live?"detection?":"history?")+params)}`}>{t?.task_code||r.raw_payload.task_id?.slice(0,8)||"隔离记录"}</HashLink><div>{r.business_context?.spool_code||(pages[0]?.scope?.members||data.spools).find(s=>s.id===t?.spool_id)?.spool_code||t?.context_snapshot?.spool_code||"未绑定"}</div></>,<>{r.raw_payload.device_id}<div>{names[r.metric_code]}</div></>,(live?labelTime(r.received_at).replace(/ 北京时间$/,''):r.raw_payload.position_m??"未知"),`${r.value??"—"} ${r.unit}`,<><Badge tone={r.quality_result==="FAIL"?"red":r.quality_result==="PASS"?"green":"gray"}>{quality[r.quality_result]||r.quality_result}</Badge><div title={r.raw_payload.data_status}>{{VALID:"有效",INVALID:"无效",MISSING:"缺测"}[r.raw_payload.data_status]||r.raw_payload.data_status}</div></>,environmentLabel(r.raw_payload.data_environment),<Button onClick={()=>setChosen(r)}>详情</Button>];})} />}
      <div className="row measurement-pagination">
        <Button disabled={!index||busy} onClick={()=>setIndex(index-1)}>上一页</Button>
        <Button disabled={!page?.has_more||busy||!!error} onClick={()=>void next()}>下一页</Button>
        <span className="muted small">第 {page?index+1:0} / {page?Math.max(1,Math.ceil((page.total??rows.length)/pageSize)):0} 页 · 共 {page?.total??rows.length} 条</span>
        {qualityFilter === "FAIL" && <span className="filter-active-note">已筛选：仅显示服务端判定为超限的记录</span>}
        {qualityFilter === "PASS" && <span className="filter-active-note filter-active-pass">已筛选：仅显示符合规则记录</span>}
        <label className="muted small">每页显示 <select aria-label="每页显示条数" value={pageSize} disabled={busy} onChange={e=>setPageSize(Number(e.target.value))}>{[25,50,100].map(size=><option key={size} value={size}>{size} 条</option>)}</select></label>
        {!live&&<span className="muted small">查询截止：{labelTime(pages[0]?.as_of)}</span>}
      </div>
    </Panel>
    <Drawer title="原始测量记录" open={!!chosen} onClose={()=>setChosen(null)}>{chosen&&<><p><strong>{chosen.value??"—"} {chosen.unit}</strong> · {{VALID:"有效",INVALID:"无效",MISSING:"缺测"}[chosen.raw_payload.data_status]||chosen.raw_payload.data_status}</p><p>采样时间：{labelTime(chosen.raw_payload.sample_time)}</p><p>设备：{chosen.raw_payload.device_id} · {names[chosen.metric_code]}</p><p>{!live&&<>来源米数：{chosen.raw_payload.position_m??"未知"}（未验证） · </>}{environmentLabel(chosen.raw_payload.data_environment)}</p><p>判定：{quality[chosen.quality_result]} · {chosen.evaluation_reason||"—"}</p><p>查询时关联盘号：{chosen.business_context?.spool_code||"—"} · 关联版本：{chosen.business_context?.association_version||"—"}</p><p>创建时盘号：{chosen.business_context?.original_spool_code||data.tasks.find(t=>t.id===chosen.raw_payload.task_id)?.context_snapshot?.spool_code||"未绑定"}</p><p>{!live&&<>位置资格：{chosen.position_eligibility==="UNVERIFIED"?"未验证":chosen.position_eligibility} · </>}接收：{chosen.receipt_status==="STORED"?"已存储":chosen.receipt_status==="QUARANTINED"?"隔离":chosen.receipt_status}</p><p>接收时间：{labelTime(chosen.received_at)}</p>{chosen.metric_code === "OVALITY" && (()=>{const rawData=(chosen.raw_payload as any)?.raw?.data as Record<string,unknown>|undefined;const obs=rawData?.observation as Record<string,unknown>|undefined;const hasAxes=obs?.diameter_x_mm!==undefined&&obs?.diameter_y_mm!==undefined&&Number.isFinite(Number(obs.diameter_x_mm))&&Number.isFinite(Number(obs.diameter_y_mm));if(!hasAxes)return <section className="sheath-thickness-card" aria-label="双向测径仪观测明细" data-testid="ovality-drawer-card"><div className="sheath-card-header"><strong>双向测径仪观测明细（170A-2D）</strong><Badge tone="gray">仅标量记录</Badge></div><p className="sheath-footnote">本条记录未携带 X/Y 轴两点距离原始观测字段（前端不虚构默认尺寸，仅展示服务端已存储的不圆度标量值 {chosen.value??"—"} {chosen.unit}）。</p></section>;const dx=String(obs!.diameter_x_mm),dy=String(obs!.diameter_y_mm),nx=Number(dx),ny=Number(dy);const major=obs!.major_axis_mm!==undefined?String(obs!.major_axis_mm):String(Math.max(nx,ny));const minor=obs!.minor_axis_mm!==undefined?String(obs!.minor_axis_mm):String(Math.min(nx,ny));const avgD=obs!.average_diameter_mm!==undefined?String(obs!.average_diameter_mm):((nx+ny)/2).toFixed(6);const diffD=obs!.ovality_difference_mm!==undefined?String(obs!.ovality_difference_mm):Math.abs(nx-ny).toFixed(6);const centripetalF=obs!.centripetal_ratio_f!==undefined?String(obs!.centripetal_ratio_f):(Math.max(nx,ny)>0?(Math.min(nx,ny)/Math.max(nx,ny)).toFixed(6):"—");const regs=obs!.registers as Record<string,unknown>|undefined;const posX=obs!.axis1_position_pct??regs?.["0x0203_axis1_position"]??0;const posY=obs!.axis2_position_pct??regs?.["0x0205_axis2_position"]??0;const modelName=String(obs!.instrument_model||rawData?.instrument_model||"Opmac-170AL2-2D");const panelSymbol=String(obs!.panel_display_symbol||(chosen.quality_result==="FAIL"?"Alm+":"Norm"));return <section className="sheath-thickness-card" aria-label="双向测径仪观测明细" data-testid="ovality-drawer-card"><div className="sheath-card-header"><strong>170A-2D 双向测径仪观测与椭圆长短轴数据（{modelName}）</strong><Badge tone={chosen.quality_result==="FAIL"?"red":chosen.quality_result==="PASS"?"green":"gray"}>面板状态 {panelSymbol} · 实报解析</Badge></div><div className="sheath-stats-row"><div className="sheath-stat-cell"><span className="stat-label">轴 1 测量直径 X (0°—180° 两点距离)</span><strong className="stat-value">{compactDecimal(dx)} <small>mm</small></strong><span className="stat-note">主机 X 轴 (202H/42H) · 光束位置偏移 {String(posX)}% (203H)</span></div><div className="sheath-stat-cell"><span className="stat-label">轴 2 测量直径 Y (90°—270° 两点距离)</span><strong className="stat-value">{compactDecimal(dy)} <small>mm</small></strong><span className="stat-note">从机 Y 轴 (204H/43H) · 光束位置偏移 {String(posY)}% (205H)</span></div><div className="sheath-stat-cell"><span className="stat-label">椭圆长轴 a / 短轴 b</span><strong className="stat-value">{compactDecimal(major)} / {compactDecimal(minor)} <small>mm</small></strong><span className="stat-note">椭圆度误差 OvAL = |X−Y| = {compactDecimal(diffD)} mm · 向心率 f(b/a) = {compactDecimal(centripetalF)}</span></div><div className="sheath-stat-cell"><span className="stat-label">平均直径 (X + Y) ÷ 2 (201H/41H)</span><strong className="stat-value">{compactDecimal(avgD)} <small>mm</small></strong><span className="stat-note">{chosen.unit==='1'?'圆整度 = min(X,Y)÷max(X,Y) = ':'历史不圆度 = 2×(a−b)÷(a+b)×100% = '}{compactDecimal(chosen.value)} {chosen.unit}</span></div></div>{regs&&<div className="sheath-drawer-points"><span>170A-2D / OpmacBL 寄存器：</span><code>200H状态:{String(regs["0x0200_status_word"]??"0x0002")}</code><code>201H均径:{String(regs["0x0201_avg_diameter_001mm"]??"—")}</code><code>202H X径:{String(regs["0x0202_axis1_diameter_001mm"]??"—")}</code><code>203H X位:{String(regs["0x0203_axis1_position"]??posX)}</code><code>204H Y径:{String(regs["0x0204_axis2_diameter_001mm"]??"—")}</code><code>205H Y位:{String(regs["0x0205_axis2_position"]??posY)}</code>{regs["0x003E_run_status"]!==undefined&&<code>3EH运行:{String(regs["0x003E_run_status"])}</code>}</div>}{regs?.rx_frame_hex!==undefined&&<div className="sheath-drawer-points"><span>Modbus-RTU 报文帧：</span>{regs.tx_frame_hex!==undefined&&<code>TX: {String(regs.tx_frame_hex)}</code>}<code>RX: {String(regs.rx_frame_hex)}</code></div>}<p className="sheath-footnote">数据严格取自本条记录 raw.data.observation（依据《OpmacBL说明书2026-06》与《170A-2D双向测径仪补充说明》：双轴测径仪实测 X/Y 两点距离，由椭圆长轴 a 与短轴 b 演算得到椭圆度 OvAL、向心率 f 及百分比不圆度）。</p></section>;})()}{chosen.metric_code === "SHIELD_OVERLAP_RATE" && <section className="measurement-illustration" aria-labelledby="measurement-illustration-title"><div className="measurement-illustration__header"><div><h3 id="measurement-illustration-title">金属屏蔽搭盖异常示例</h3><span className="measurement-illustration__tag">用户提供异常示例 · 非本次记录实拍</span></div><p>用于查看金属屏蔽搭盖异常的外观参考；该图未绑定当前测量记录，也不影响本条判定。</p></div><figure><img src="/measurement-examples/metal-shield-overlap-example.png" alt="金属屏蔽搭盖异常外观示例图" loading="lazy"/><figcaption>示例图片仅用于说明异常外观，不代表当前记录的实拍结果或质量判定。</figcaption></figure></section>}{chosen.quality_result==="FAIL"&&<DefectExamples timeOnly={live} api={api} record={chosen} task={task||data.tasks.find(t=>t.id===chosen.raw_payload.task_id)} compact key={chosen.id} failed={1} context={`记录 ${chosen.id} · ${labelTime(chosen.raw_payload.sample_time)}`}/>}<details className="ux-technical"><summary>技术详情（原始JSON与内部ID）</summary><p>记录ID：<code>{chosen.id}</code> <Button onClick={()=>void navigator.clipboard.writeText(chosen.id)}>复制记录ID</Button></p><p>原始值与来源序号按字符串保留；趋势图数值仅用于绘制。</p><pre className="b2-json">{JSON.stringify(chosen.raw_payload,null,2)}</pre></details><HashLink route={`task?id=${chosen.raw_payload.task_id}&back=${encodeURIComponent((live?"detection?":"history?")+params)}`}>关联任务</HashLink></>}</Drawer>
  </>;
}
