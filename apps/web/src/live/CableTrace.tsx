import {useEffect,useState} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {Button} from '../ui/Button';
import {Field} from '../ui/Field';
import {Note} from '../ui/Note';
import {HashLink} from '../ui/HashLink';
import {SpoolEditor,type ProductionProps} from './ProductionPages';
import {environmentLabel,names,taskState,labelTime,specificationLabel,ruleText,type Spool,type Task} from './api';

export type SampleSummary={task_id:string;total:number;valid:number;invalid:number;passed:number;failed:number;unevaluated:number;quarantined:number;first_sample_at:string|null;latest_sample_at:string|null;minimum:string|null;maximum:string|null;mean:string|null;unit:string|null};
export type SpoolSummary={root_id:string;requested_id:string;members:(Spool&{external_code:string;specification_id:string})[];tasks:Task[];measurements:SampleSummary[];as_of:string;scope_hash:string};
const counts=(rows:SampleSummary[],key:'total'|'valid'|'invalid'|'failed'|'unevaluated'|'quarantined')=>rows.reduce((sum,r)=>sum+r[key],0);

export function CableTrace({api,data,commands,refresh,user,id,listBack}:Pick<ProductionProps,'api'|'data'|'commands'|'refresh'|'user'>&{id:string;listBack?:string}){
 const [result,setResult]=useState<SpoolSummary|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [metric,setMetric]=useState(''),[state,setState]=useState(''),[page,setPage]=useState(0);
 useEffect(()=>{let active=true;const controller=new AbortController();setResult(null);setError('');
  api.request<SpoolSummary>('/spool-summaries/'+encodeURIComponent(id),undefined,{},controller.signal).then(r=>{if(active)setResult(r);}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;controller.abort();};
 },[api,id,revision]);
 async function reload(){await refresh();setRevision(x=>x+1);}
 if(error)return <><PageTitle title="线缆档案与追溯"/><Note><span role="alert">{error}</span></Note><Button onClick={()=>setRevision(x=>x+1)}>重新查询</Button><HashLink route={listBack||"trace"}>{listBack?.startsWith("workorders?")?"返回工单详情":"返回线缆列表"}</HashLink></>;
 if(!result)return <Note>正在读取本盘任务与采样汇总…</Note>;
 const root=result.members.find(s=>s.id===result.root_id)!,spec=data.catalog.product_specification.find(s=>s.id===root.specification_id);
 const byTask=new Map(result.measurements.map(m=>[m.task_id,m])),back=`trace?spool=${id}${listBack?"&back="+encodeURIComponent(listBack):""}`;
 const history=(extra='')=>`history?spool=${id}${extra}`;
 const groups=new Map<string,{metric:string;process:string;environment:string;tasks:Task[]}>();
 for(const t of result.tasks){const key=[t.process_id,t.metric_code,t.data_environment].join('|');if(!groups.has(key))groups.set(key,{metric:t.metric_code,process:t.process_id,environment:t.data_environment,tasks:[]});groups.get(key)!.tasks.push(t);}
 const filtered=result.tasks.filter(t=>(!metric||t.metric_code===metric)&&(!state||t.state===state));
 const current=Math.min(page,Math.max(0,Math.ceil(filtered.length/20)-1));
 return <><PageTitle title={`线缆详情 · ${root.spool_code}`} subtitle={`主盘 ${root.id} · 汇总截止 ${labelTime(result.as_of)}`} actions={<><HashLink route={listBack||"trace"}>{listBack?.startsWith("workorders?")?"返回工单详情":"返回线缆列表"}</HashLink><Button onClick={()=>void reload()}>刷新汇总</Button><SpoolEditor {...{data,commands,user}} refresh={reload} id={id}/></>}/>
  {id!==root.id&&<Note>当前从成员盘进入，汇总范围为主盘及全部成员；修改按钮维护当前成员身份。</Note>}
  <Panel core title="线缆档案"><div className="detail-grid"><div>工单：{root.external_code}</div><div>规格：{specificationLabel(spec)}</div><div>屏蔽结构：{spec?.shield_structure||'—'}</div><div>身份数：{result.members.length} · 物理盘汇总：1盘</div><div>任务：{result.tasks.length} · 结束 {result.tasks.filter(t=>t.state==='ENDED').length} · 取消 {result.tasks.filter(t=>t.state==='CANCELLED').length}</div><div>样本：{counts(result.measurements,'total')} · 有效 {counts(result.measurements,'valid')} · 无效/缺测 {counts(result.measurements,'invalid')}</div><div>超限：{counts(result.measurements,'failed')} · 未判定 {counts(result.measurements,'unevaluated')} · 隔离 {counts(result.measurements,'quarantined')}</div><div>实际长度 / 有效覆盖 / 整盘质量：未形成结论</div></div></Panel>
  <Panel core table title="分工序检测全景" tools={<HashLink route={history()}>查询本盘全部历史</HashLink>}><DataTable headers={['工序 / 指标 / 来源','任务执行','样本 / 有效 / 无效','超限 / 未判定','最近采样（北京时间）','追溯']} rows={[...groups.values()].map(g=>{const rows=g.tasks.flatMap(t=>byTask.has(t.id)?[byTask.get(t.id)!]:[]),last=rows.map(s=>s.latest_sample_at).filter(Boolean).sort().at(-1);return [<>{data.catalog.inspection_process.find(p=>p.id===g.process)?.name||g.process}<div>{names[g.metric]} · {environmentLabel(g.environment)}</div></>,`${g.tasks.length}次 · 待开始 ${g.tasks.filter(t=>t.state==='CREATED').length} / 运行 ${g.tasks.filter(t=>t.state==='RUNNING').length} / 结束 ${g.tasks.filter(t=>t.state==='ENDED').length} / 取消 ${g.tasks.filter(t=>t.state==='CANCELLED').length}`,`${counts(rows,'total')} / ${counts(rows,'valid')} / ${counts(rows,'invalid')}`,`${counts(rows,'failed')} / ${counts(rows,'unevaluated')}`,labelTime(last),<HashLink route={history('&metric_code='+g.metric+'&environment='+g.environment+'&process_id='+encodeURIComponent(g.process))}>本项历史</HashLink>];})}/>
   <div className="row">{Object.entries(names).filter(([code])=>!result.tasks.some(t=>t.metric_code===code)).map(([code,name])=><span key={code}>{name}：{data.catalog.specification_applicability.some(a=>a.specification_id===spec?.id&&a.metric_code===code)?'未分配任务':'不适用'}</span>)}</div>
   <Note>同项多次检测全部保留，尚未选择复检采用结果。仅统计记录数量；不同任务长度不相加，不能用点数替代检测覆盖或整盘合格率。</Note>
  </Panel>
  <Panel core table title="逐任务检测与采样"><div className="filters"><Field label="检测项"><select value={metric} onChange={e=>{setMetric(e.target.value);setPage(0);}}><option value="">全部项目</option>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="执行状态"><select value={state} onChange={e=>{setState(e.target.value);setPage(0);}}><option value="">全部状态</option>{Object.entries(taskState).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field></div>
   <DataTable className="b3r1-task-table" headers={['任务 / 来源盘','检测项 / 设备 / 规则','状态 / 来源','计划 / 上报长度 m','样本 / 有效 / 无效','超限 / 未判定','有效已存值 最小 / 最大 / 均值','首末采样（北京时间）','操作']} rows={filtered.slice(current*20,current*20+20).map(t=>{const m=byTask.get(t.id),spool=result.members.find(s=>s.id===t.spool_id);return [<><HashLink route={`task?id=${t.id}&back=${encodeURIComponent(back)}`}>{t.task_code}</HashLink><div>当前：{spool?.spool_code}</div><div className="muted small">创建时：{t.context_snapshot.spool_code}</div></>,<>{names[t.metric_code]} · {t.device_id}<div>{ruleText(t.rule_snapshot)}</div></>,`${taskState[t.state]} · ${environmentLabel(t.data_environment)}`,`${t.planned_length_m??'未知'} / ${t.reported_length_m??'未知'}（未校准）`,`${m?.total||0} / ${m?.valid||0} / ${m?.invalid||0}`,`${m?.failed||0} / ${m?.unevaluated||0}`,m?<>{m.minimum??'—'} / {m.maximum??'—'} / {m.mean??'—'} {m.unit}</>:'无采样',<>{labelTime(m?.first_sample_at)}<br/>{labelTime(m?.latest_sample_at)}</>,<HashLink route={history('&task_id='+t.id)}>测量历史</HashLink>];})}/>
   <div className="row"><Button disabled={!current} onClick={()=>setPage(current-1)}>上一页</Button><span>共 {filtered.length} 项 · 第 {current+1} 页</span><Button disabled={(current+1)*20>=filtered.length} onClick={()=>setPage(current+1)}>下一页</Button></div>
  </Panel>
  <Panel core table title="线缆身份与关联范围"><DataTable headers={['身份','当前盘号','所属工单','内部ID / 版本','操作']} rows={result.members.map(s=>[s.id===root.id?'主盘':'成员盘',s.spool_code,s.external_code,`${s.id} / ${s.version}`,<HashLink route={`trace?spool=${s.id}`}>维护此身份</HashLink>])}/><Note>改名和整盘归并不改写原任务ID、来源盘ID与创建快照；归并可解除。单个任务可在任务详情更正关联；质量采用尚未开通。</Note></Panel>
 </>;
}
