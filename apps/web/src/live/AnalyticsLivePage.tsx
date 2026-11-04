import {useEffect,useMemo,useState} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {Button} from '../ui/Button';
import {Badge} from '../ui/Badge';
import {Note} from '../ui/Note';
import {Field} from '../ui/Field';
import {DataTable} from '../ui/DataTable';
import {HashLink} from '../ui/HashLink';
import {csvCell,downloadFile} from '../ui/download';
import {names,taskState,labelTime,specificationLabel,type Workspace,type Person,type ApiClient,type Task} from './api';
import {analyticsMetrics,loadAnalyticsTasks,summarizeTasks,numberText,valueText,resultColors,resultNames} from './analyticsData';
import {AnalyticsChart,comparisonOption,distributionOption,trendOption,trendTasks} from './AnalyticsCharts';
import './analytics.css';

type Props={data:Workspace;user:Person;api:ApiClient};
export function AnalyticsLivePage({data,api}:Props){
  const [snapshot,setSnapshot]=useState<{tasks:Task[];asOf:string}|null>(null);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0);
  const [metric,setMetric]=useState(''),[state,setState]=useState(''),[spec,setSpec]=useState(''),[keyword,setKeyword]=useState(''),[environment,setEnvironment]=useState('');
  const [focus,setFocus]=useState(''),[trendMetric,setTrendMetric]=useState('SHIELD_OVERLAP_RATE'),[page,setPage]=useState(1);
  useEffect(()=>{
    const controller=new AbortController();let active=true;setBusy(true);setError('');
    loadAnalyticsTasks(api,controller.signal).then(v=>{if(active){setSnapshot(v);setPage(1);}}).catch(e=>{if(active&&!controller.signal.aborted)setError(e.message||'统计读取失败');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;controller.abort();};
  },[api,tick]);
  const filtered=useMemo(()=>snapshot?.tasks.filter(t=>{
    if(metric&&t.metric_code!==metric||state&&t.state!==state||spec&&t.specification_id!==spec||environment&&t.data_environment!==environment)return false;
    const q=keyword.trim().toLowerCase();
    return !q||[t.task_code,t.current_spool_code||t.context_snapshot?.spool_code,t.current_order_code||t.context_snapshot?.external_code].join(' ').toLowerCase().includes(q);
  })||[],[snapshot,metric,state,spec,keyword,environment]);
  const summary=useMemo(()=>summarizeTasks(filtered),[filtered]);
  const stats=useMemo(()=>analyticsMetrics.map(m=>({...m,...summarizeTasks(filtered.filter(t=>t.metric_code===m.code))})),[filtered]);
  const activeMetric=metric||trendMetric;
  const trendRows=useMemo(()=>trendTasks(filtered,activeMetric),[filtered,activeMetric]);
  const options=useMemo(()=>({distribution:distributionOption(filtered),comparison:comparisonOption(filtered),trend:trendOption(filtered,activeMetric)}),[filtered,activeMetric]);
  const detail=filtered.filter(t=>focus==='FAIL'?(t.measurements!.failed>0):focus==='INVALID'?(t.measurements!.invalid>0):true);
  const pageCount=Math.max(1,Math.ceil(detail.length/10)),currentPage=Math.min(page,pageCount);
  const reset=()=>{setMetric('');setState('');setSpec('');setKeyword('');setEnvironment('');setFocus('');setPage(1);};
  function exportCsv(){
    const columns=['任务编号','当前盘号','当前工单','检测项','状态','数据来源','采样总数','符合规则','超限','有效','无效/缺测','均值','最小值','最大值','单位','末次采样时间UTC'];
    const rows=detail.map(t=>{const m=t.measurements!;return [t.task_code,t.current_spool_code||t.context_snapshot?.spool_code,t.current_order_code||t.context_snapshot?.external_code,names[t.metric_code],taskState[t.state],t.data_environment,m.total,m.passed,m.failed,m.valid,m.invalid,m.mean,m.minimum,m.maximum,m.unit,m.latest_sample_at];});
    downloadFile('慧眼智检-质量统计.csv','\uFEFF'+[columns,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
  }
  const metricLink=(code:string)=>`detection?metric=${{SHIELD_OVERLAP_RATE:'dg',WIRE_GAP:'jx',OVALITY:'by',SHEATH_THICKNESS:'ht'}[code as 'OVALITY']}`;
  return <div className="analytics-page ana2">
    <PageTitle title="质量统计分析" subtitle="从整体判定到单项波动，让每一条检测结果可见、可追溯。" actions={<><Button disabled={busy} onClick={()=>setTick(n=>n+1)}>{busy?'正在更新…':'刷新统计'}</Button><Button primary icon="download" disabled={!snapshot||busy||!!error||!detail.length} onClick={exportCsv}>导出统计 CSV</Button></>}/>
    <div className="ana-scope"><span><i/> 数据库任务摘要 <b>·</b> 当前账号可见范围</span><span>{snapshot?`更新于 ${labelTime(snapshot.asOf).replace(/ 北京时间$/,'')}（北京时间）`:'正在连接统计数据…'}</span></div>
    <div className="analytics-filter-grid">
      <Field label="检测项目"><select value={metric} onChange={e=>{setMetric(e.target.value);setPage(1);}}><option value="">全部四项检测</option>{analyticsMetrics.map(m=><option key={m.code} value={m.code}>{m.name}</option>)}</select></Field>
      <Field label="任务状态"><select value={state} onChange={e=>{setState(e.target.value);setPage(1);}}><option value="">全部状态</option>{Object.entries(taskState).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="产品规格"><select value={spec} onChange={e=>{setSpec(e.target.value);setPage(1);}}><option value="">全部规格</option>{data.catalog.product_specification.map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field>
      <Field label="数据来源"><select value={environment} onChange={e=>{setEnvironment(e.target.value);setPage(1);}}><option value="">全部来源</option><option value="SIMULATED">外部输入</option><option value="REAL">设备采集</option></select></Field>
      <Field label="任务 / 盘号 / 工单"><input value={keyword} placeholder="搜索编号或名称" onChange={e=>{setKeyword(e.target.value);setPage(1);}}/></Field>
      <Button onClick={reset}>重置</Button>
    </div>
    {error&&<Note><span role="alert">统计读取失败：{error}。{snapshot?'当前保留上次成功结果。':'未生成统计结果。'}</span><Button disabled={busy} onClick={()=>setTick(n=>n+1)}>重新读取</Button></Note>}
    {!snapshot?<div className="ana-loading">{busy?'正在汇总任务与检测记录…':'统计暂不可用，请重新读取。'}</div>:<>
    <div className="ana-kpis" aria-label="统计关键结果">
      <article className="ana-kpi ana-kpi-primary"><span>检测记录总数 <b>RECORDS</b></span><strong>{numberText(summary.total)}<small>条</small></strong><p>{summary.taskCount} 个任务 <em>·</em> {summary.spools} 盘线缆</p><div className="ana-kpi-track"><i style={{width:`${summary.total?summary.valid/summary.total*100:0}%`}}/></div></article>
      <article className="ana-kpi"><span>已判定符合率 <i className="ana-dot green"/></span><strong>{summary.rate}</strong><p>符合 {numberText(summary.passed)} / 已判定 {numberText(summary.passed+summary.failed)}</p><small className="ana-caption">按采样记录统计，不代表整盘放行</small></article>
      <article className="ana-kpi"><span>超限记录 <i className="ana-dot red"/></span><strong className={summary.failed?'ana-red':''}>{numberText(summary.failed)}<small>条</small></strong><p>{filtered.filter(t=>t.measurements!.failed>0).length} 个任务存在超限</p><button className="ana-text-button" onClick={()=>{setFocus('FAIL');setPage(1);}}>筛选下方超限任务 ↓</button></article>
      <article className="ana-kpi"><span>无效 / 缺测 <i className="ana-dot slate"/></span><strong>{numberText(summary.invalid)}<small>条</small></strong><p>未计入符合或超限</p><button className="ana-text-button" onClick={()=>{setFocus('INVALID');setPage(1);}}>筛选下方无效数据任务 ↓</button></article>
    </div>
    <div className="ana-overview-grid">
      <Panel core title="检测结果分布" tools={<span className="ana-eyebrow">判定构成</span>}>
        <div className="ana-donut-layout">
          <div className="ana-donut"><AnalyticsChart option={options.distribution} label={`检测结果分布：符合${summary.passed}、超限${summary.failed}条`} height={220}/><div className="ana-donut-center"><strong>{numberText(summary.passed+summary.failed)}</strong><span>判定记录</span></div></div>
          <div className="ana-result-legend">{[summary.passed,summary.failed].map((n,i)=><div key={i}><span><i style={{background:resultColors[i]}}/>{resultNames[i]}</span><strong>{numberText(n)}<small>{(summary.passed+summary.failed)?(n/(summary.passed+summary.failed)*100).toFixed(1):'0'}%</small></strong></div>)}</div>
        </div>
        <div className="ana-source-line"><span>外部输入 <b>{numberText(summary.simulated)}</b></span><span>真实设备 <b>{numberText(summary.real)}</b></span></div>
      </Panel>
      <Panel core title="四项检测对比" tools={<span className="ana-eyebrow">记录数 · 同一筛选范围</span>}>
        {summary.total?<AnalyticsChart option={options.comparison} label="四项检测符合与超限记录数对比" height={258}/>:<div className="ana-chart-empty">当前范围暂无检测记录</div>}
      </Panel>
    </div>
    <div className="ana-section-label"><div><span>01</span><h2>分项结果概览</h2></div><p>不同单位独立展示 · 判定采用各任务冻结规则</p></div>
    <div className="metric-analysis-cards">{stats.filter(m=>!metric||metric===m.code).map(m=><article className="ana-metric" key={m.code} style={{'--metric-color':m.color} as React.CSSProperties}>
      <header><span className="ana-metric-icon">{m.unit}</span><div><h3>{m.name}</h3><span>{m.taskCount} 个任务 · {numberText(m.total)} 条记录</span></div><HashLink route={metricLink(m.code)}>查看 ↗</HashLink></header>
      <div className="ana-metric-range"><span>有效已存储测量范围</span><strong>{valueText(m.minimum)} <em>—</em> {valueText(m.maximum)} <small>{m.unit}</small></strong></div>
      <div className="ana-segment-bar" aria-label={`符合${m.passed}、超限${m.failed}`}>{[m.passed,m.failed].map((n,i)=><i key={i} style={{width:`${(m.passed+m.failed)?n/(m.passed+m.failed)*100:0}%`,background:resultColors[i]}}/>)}</div>
      <footer><div><span>已判定符合率</span><b>{m.rate}</b></div><div><span>超限</span><b className={m.failed?'ana-red':''}>{numberText(m.failed)}</b></div><div><span>无效 / 缺测</span><b>{numberText(m.invalid)}</b></div></footer>
    </article>)}</div>
    <div className="ana-section-label"><div><span>02</span><h2>任务间测量趋势</h2></div><p>按末次采样时间排列 · 北京时间</p></div>
    <Panel core title={`${analyticsMetrics.find(m=>m.code===activeMetric)!.name} · 任务均值`} tools={<div className="ana-chart-tabs" role="group" aria-label="趋势检测项目">{analyticsMetrics.filter(m=>!metric||metric===m.code).map(m=><button key={m.code} aria-pressed={activeMetric===m.code} onClick={()=>setTrendMetric(m.code)}>{m.short}</button>)}</div>}>
      <div className="ana-trend-meta"><span><i style={{background:analyticsMetrics.find(m=>m.code===activeMetric)!.color}}/> 每个点代表一个任务的有效已存储测量均值</span><strong>{trendRows.length} 个任务</strong></div>
      {trendRows.length?<AnalyticsChart option={options.trend} label={`${analyticsMetrics.find(m=>m.code===activeMetric)!.name}任务均值时间趋势`} height={280}/>:<div className="ana-chart-empty">当前检测项目暂无可用均值</div>}
      <p className="ana-caption">任务可能采用不同冻结规则；均值不代替单点判定。查看逐点曲线，请进入任务“回看检测”。</p>
    </Panel>
    <div className="ana-section-label"><div><span>03</span><h2>任务结果与追溯</h2></div><p>有效 {numberText(summary.valid)} · 无效 / 缺测 {numberText(summary.invalid)} · 隔离 {numberText(summary.quarantined)}</p></div>
    <Panel core table title="任务检测明细" tools={<div className="ana-chart-tabs" role="group" aria-label="明细任务筛选">{[['','全部任务'],['FAIL','含超限'],['INVALID','含无效/缺测']].map(([v,n])=><button key={v} aria-pressed={focus===v} onClick={()=>{setFocus(v);setPage(1);}}>{n}</button>)}</div>}>
      <DataTable emptyText="当前筛选范围没有任务" headers={['任务 / 当前盘号','检测项 / 来源','末次采样（北京时间）','符合 / 超限','任务均值','任务状态','追溯']} rows={detail.slice((currentPage-1)*10,currentPage*10).map(t=>{
        const m=t.measurements!,code={SHIELD_OVERLAP_RATE:'dg',WIRE_GAP:'jx',OVALITY:'by',SHEATH_THICKNESS:'ht'}[t.metric_code as 'OVALITY'];
        return [<><HashLink route={`task?id=${t.id}&back=analytics`}>{t.task_code}</HashLink><div className="ana-subcell">{t.current_spool_code||t.context_snapshot?.spool_code||'—'}</div><small className="muted">{t.current_order_code||t.context_snapshot?.external_code||'—'}</small></>,<>{names[t.metric_code]}<div className="ana-subcell">{t.data_environment==='SIMULATED'?'外部输入':t.data_environment==='REAL'?'设备采集':t.data_environment}</div></>,m.latest_sample_at?labelTime(m.latest_sample_at).replace(/ 北京时间$/,''):'尚未采样',<div className="ana-result-numbers"><b>{numberText(m.passed)}</b><em>/</em><b className={m.failed?'ana-red':''}>{numberText(m.failed)}</b></div>,<>{m.mean==null?'—':valueText(Number(m.mean))} <small>{m.unit||''}</small></>,<Badge tone={t.state==='RUNNING'?'blue':'gray'}>{taskState[t.state]||t.state}</Badge>,<div className="ana-links"><HashLink route={`detection?metric=${code}&task=${t.id}&back=analytics`}>回看检测</HashLink><HashLink route={`history?task_id=${t.id}`}>原始记录</HashLink></div>];
      })}/>
      <div className="ana-pagination"><span>共 {detail.length} 个任务 · 第 {currentPage} / {pageCount} 页</span><div><Button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</Button><Button disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>下一页</Button></div></div>
    </Panel>
    <details className="ana-definitions"><summary>统计口径与数据说明</summary><p>统计来自服务端各任务采样摘要；符合率分母为已判定记录（符合＋超限），缺少有效判定依据的记录不计入分母。有效性、隔离状态与质量判定是不同维度，不可相加。趋势为按末次采样时间排列的任务均值，不表示连续逐点测量；范围和图表显示精度不代表仪器精度。历史记录保留原判定依据，本页面不补判、不修改任务规则。分页查询期间有新任务加入时，请刷新重新汇总。</p></details>
    </>}
  </div>;
}
