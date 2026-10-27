import {AdvancedFilters,DateTimeField,ScopedOptions} from "./UxFields";
import {SpoolForm,TaskForm} from "./TaskForms";
import type {ProductionProps} from "./ProductionPages";
import {useState} from 'react';
import {Panel} from '../ui/Panel';
import {PageTitle} from '../ui/PageTitle';
import {DataTable} from '../ui/DataTable';
import {Field} from '../ui/Field';
import {Button} from '../ui/Button';
import {Note} from '../ui/Note';
import {HashLink} from '../ui/HashLink';
import {navigate} from '../app/hashRoute';
import {environmentLabel,names,labelTime,specificationLabel,type ApiClient,type Workspace} from './api';

export {useRead} from '../shared/useRead';
import {useRead} from '../shared/useRead';
export const planStates:Record<string,string>={DRAFT:'待生成',READY:'待执行',RUNNING:'执行中',PARTIAL:'部分结束',COMPLETED:'执行完成',FAILED:'执行有失败项',EMPTY:'无有效项'};
export const cableStates:Record<string,string>={NO_TASK:'未分配任务',WAITING:'待检测',RUNNING:'检测中',PARTIAL:'部分结束',COMPLETED:'执行结束',CANCELLED:'全部取消'};
type ListResult={items:any[];total:number;page:number;limit:number;as_of:string;active_items?:number;failed_items?:number;tasks?:number;running_tasks?:number};
type Props={api:ApiClient;data:Workspace;params:URLSearchParams;revision?:number};
export function ServerList({api,data,params,revision=0,kind,context,onAssign,scopeSpec}:{kind:'plans'|'spools';scopeSpec?:string;onAssign?:(row:any)=>void;context?:{route:string;params:Record<string,string>}}&Props){
 const [tick,setTick]=useState(0),isPlan=kind==='plans',base=isPlan?'tasks?view=plans':'trace',route=context?.route||(isPlan?'tasks':'trace');
 const allowed=['q','state','specification_id','device_id','process_id','environment','from','to','page','limit',...(isPlan?['has_errors']:['metric_code','line_id','work_order_id'])];
 const query=new URLSearchParams();for(const name of allowed)if(params.get(name))query.set(name,params.get(name)!);
 if(!query.has('limit'))query.set('limit','20');
 const {value,error}=useRead<ListResult>(api,`/production/${kind}?${query}`,revision+':'+tick);
 function go(q:URLSearchParams){if(context)for(const [k,v] of Object.entries(context.params))q.set(k,v);if(isPlan)q.set('view','plans');navigate(route+'?'+q);}
 const back=route+'?'+params.toString();
 return <>
  <form key={params.toString()} className="filters" onSubmit={e=>{e.preventDefault();const q=new URLSearchParams();if(params.get('work_order_id'))q.set('work_order_id',params.get('work_order_id')!);new FormData(e.currentTarget).forEach((v,k)=>{if(String(v))q.set(k,String(v));});go(q);}}>
   <Field label={isPlan?'计划 / 任务 / 盘号 / 工单':'盘号 / 工单 / 任务'}><input name="q" defaultValue={params.get('q')||''} maxLength={128}/></Field>
   <Field label="执行状态"><select name="state" defaultValue={params.get('state')||''}><option value="">全部</option>{Object.entries(isPlan?planStates:cableStates).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></Field>
   <AdvancedFilters params={params} keys={["specification_id","device_id","process_id","environment","from","to","metric_code","line_id","has_errors"]}><Field label="规格"><select name="specification_id" defaultValue={params.get('specification_id')||''}><option value="">全部规格</option>{data.catalog.product_specification.filter(s=>!scopeSpec||s.id===scopeSpec||s.id===params.get("specification_id")).map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field>
   <Field label="设备"><select name="device_id" defaultValue={params.get('device_id')||''}><option value="">全部设备</option><ScopedOptions selected={params.get("device_id")} options={data.catalog.device.filter(d=>!scopeSpec||data.catalog.specification_applicability.some(a=>a.specification_id===scopeSpec&&a.process_id===d.process_id&&a.metric_code===d.metric_code)).map(d=>({id:d.id,label:d.id}))}/></select></Field>
   <Field label="工序"><select name="process_id" defaultValue={params.get('process_id')||''}><option value="">全部工序</option>{data.catalog.inspection_process.filter(p=>!scopeSpec||p.id===params.get("process_id")||data.catalog.specification_applicability.some(a=>a.specification_id===scopeSpec&&a.process_id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
   {!isPlan&&<><Field label="检测项"><select name="metric_code" defaultValue={params.get('metric_code')||''}><option value="">全部检测项</option>{Object.entries(names).filter(([k])=>!scopeSpec||k===params.get("metric_code")||data.catalog.specification_applicability.some(a=>a.specification_id===scopeSpec&&a.metric_code===k)).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="产线"><select name="line_id" defaultValue={params.get('line_id')||''}><option value="">全部产线</option>{data.catalog.production_line.filter(l=>!scopeSpec||l.id===params.get("line_id")||data.catalog.device.some(d=>d.line_id===l.id&&data.catalog.specification_applicability.some(a=>a.specification_id===scopeSpec&&a.metric_code===d.metric_code&&a.process_id===d.process_id))).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field></>}
   <Field label="数据来源"><select name="environment" defaultValue={params.get('environment')||''}><option value="">全部来源</option><option value="SIMULATED">模拟数据</option><option value="REAL">真实设备</option></select></Field>
   {isPlan&&<Field label="失败项"><select name="has_errors" defaultValue={params.get('has_errors')||''}><option value="">全部</option><option value="true">有失败项</option><option value="false">无失败项</option></select></Field>}
   <DateTimeField name="from" label="创建起点（含）" value={params.get("from")}/><DateTimeField name="to" label="创建终点（不含）" value={params.get("to")}/>
   <Field label="每页条数"><select name="limit" defaultValue={params.get('limit')||'20'}>{['20','50','100'].map(v=><option key={v}>{v}</option>)}</select></Field>
   </AdvancedFilters><Button primary type="submit">查询</Button><HashLink route={context?context.route+'?'+new URLSearchParams(context.params):base}>重置</HashLink>
  </form>
  {error&&<Note><span role="alert">查询失败：{error}</span></Note>}
  <Panel core table title={isPlan?'批量计划列表':'线缆清单'} tools={<Button onClick={()=>setTick(v=>v+1)}>{isPlan?"刷新计划列表":"刷新线缆列表"}</Button>}>
   {!value&&!error&&<Note>正在读取列表…</Note>}
   {value&&<><p>筛选内 {value.total} {isPlan?'个计划':'盘线缆'} · {isPlan?`有效执行项 ${value.active_items||0} · 失败项 ${value.failed_items||0}`:`关联任务 ${value.tasks||0} · 检测中 ${value.running_tasks||0}`}</p>
    <DataTable headers={isPlan?['计划','执行状态','申请盘 / 当前盘','有效项 / 移除','未生成 / 等待 / 运行 / 结束','失败项','创建时间（北京时间）','操作']:['线缆','工单 / 规格','执行状态 / 来源','任务 / 等待 / 运行 / 结束 / 取消','已分配检测项 / 身份数','创建时间（北京时间）','操作']} rows={value.items.map(r=>isPlan?
     [<>{r.name}<details><summary>内部ID</summary><code>{r.id}</code></details></>,planStates[r.state],`${r.spool_count} / ${r.current_spool_count}`,`${r.active_count} / ${r.removed_count}`,`${r.ungenerated_count} / ${r.waiting_count} / ${r.running_count} / ${r.ended_count}`,r.failed_count,labelTime(r.created_at),<HashLink route={`tasks?view=plans&plan=${r.id}&back=${encodeURIComponent(back)}`}>计划详情</HashLink>]:
     [<>{r.spool_code}<details><summary>内部ID</summary><code>{r.id}</code></details></>,<>{r.external_code}<div>{specificationLabel(data.catalog.product_specification.find(s=>s.id===r.specification_id))}</div></>,<>{cableStates[r.state]}<div>{r.environments.map(environmentLabel).join(' / ')||'未分配'}</div></>,`${r.task_count} / ${r.waiting_count} / ${r.running_count} / ${r.ended_count} / ${r.cancelled_count}`,<>{r.metrics.map((m:string)=>names[m]).join('、')||'未分配'}<div>{r.identity_count}个身份</div></>,labelTime(r.created_at),<div className="ux-actions"><HashLink route={`trace?spool=${r.id}&back=${encodeURIComponent(back)}`}>查看线缆</HashLink>{onAssign&&<Button onClick={()=>onAssign(r)}>分配任务</Button>}</div>])}/>
    {!value.items.length&&<Note>{value.total?'当前页已无数据，请返回第一页或刷新。':'没有符合条件的记录。'}</Note>}
    <div className="row"><Button disabled={value.page<=1} onClick={()=>{query.set('page',String(value.page-1));go(query);}}>上一页</Button><span>第 {value.page} 页 / {Math.max(1,Math.ceil(value.total/value.limit))} 页</span><Button disabled={value.page*value.limit>=value.total} onClick={()=>{query.set('page',String(value.page+1));go(query);}}>下一页</Button>{value.page>1&&<Button onClick={()=>{query.delete('page');go(query);}}>第一页</Button>}<span className="muted small">查询时间：{labelTime(value.as_of)}</span></div>
   </>}
  </Panel>
  <Note>{isPlan?'对象条件须在同一个有效执行项匹配；未生成项无已确认来源环境。':'主盘与成员身份合计为一盘；任务条件在同一任务匹配，数量展示该盘全部任务。'}执行结束不代表质量合格。列表为实时分页，数据变更后请刷新。</Note>
 </>;
}
export function CableList(props:ProductionProps){
 const [modal,setModal]=useState(''),[selected,setSelected]=useState<{id:string;work_order_id:string}|null>(null),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function open(kind:string,row?:any){setBusy(true);setError('');try{await (props.prepareForms||props.refresh)();setSelected(row||null);setModal(kind);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function reload(){await props.refresh();setRevision(v=>v+1);}
 const write=props.user.permissions.includes('task:write');
 return <><PageTitle title="线缆档案与追溯" subtitle="登记线缆身份，再按生产安排分配检测任务" actions={write&&<><Button primary disabled={busy} onClick={()=>void open('spool')}>登记线缆</Button><Button disabled={busy} onClick={()=>void open('task')}>创建检测任务</Button></>}/>{busy&&<Note>正在加载登记与任务表单…</Note>}{error&&<Note><span role="alert">{error}</span></Note>}<ServerList {...props} revision={revision} kind="spools" onAssign={write?r=>void open('task',r):undefined}/>
 {modal==='spool'&&<SpoolForm {...props} refresh={reload} close={()=>setModal('')}/>}{modal==='task'&&<TaskForm {...props} initialOrder={selected?.work_order_id} initialSpool={selected?.id} refresh={reload} close={()=>setModal('')}/>}
 </>;
}
