import {ImportConfiguration} from './ImportConfiguration';
import {OdmSource} from './OdmSource';
import {SheathDetection} from './SheathDetection';
import {RecipesPage} from './RecipesPage';
import {ReportingAnalytics as AnalyticsLivePage, ReportingReports as ReportsLivePage, ReportingView as ReportLiveView} from './reporting/ReportingPages';

import {taskDisplayLabel} from './ExecutionSummary';
import {Specifications,ManagedDevices} from './CatalogPages';
import {WorkOrders} from './WorkOrders';
import {AdminRedirect} from '../shared/AdminRedirect';
import {OperationsPage,MetricDefinitions} from './OperationsPages';
import {TaskActivityPanel} from './ActivityStatus';
import {CableList} from './ServerLists';
import { useState, type ReactNode } from "react";
import { PageTitle } from "../ui/PageTitle";
import { Panel } from "../ui/Panel";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Note } from "../ui/Note";
import { Field, TextInput } from "../ui/Field";
import { HashLink } from "../ui/HashLink";
import { Modal } from "../ui/Modal";
import { Kpi } from "../ui/Kpi";
import { routeTitles } from "../app/hashRoute";
import { ProductionTasks, PlanPages, DiscoveryPage, TaskProcess } from "./ProductionPages";
import {TaskAssociation} from "./TaskAssociation";
import {CableTrace} from "./CableTrace";
import { Measurements } from "./Measurements";
import { AnomalyRecords } from "./AnomalyRecords";
import { environmentLabel, specificationLabel, codes, names, shortCode, taskState, ruleText, labelTime, type ApiClient, type Commands, type Workspace, type Person, type Task } from "./api";
import "./live.css";

type Props={workspaceStatus?:"loading"|"ready"|"failed";route:string;params:URLSearchParams;api:ApiClient;commands:Commands;data:Workspace;user:Person;refresh:()=>Promise<void>;prepareForms?:()=>Promise<void>};
const status=(state:string)=><Badge tone={state==="RUNNING"?"blue":state==="ENDED"?"gray":"amber"}>{taskState[state]||state}</Badge>;
function TaskDetail({task,data,commands,refresh,user,api,params}: {task:Task;data:Workspace;commands:Commands;refresh:()=>Promise<void>;user:Person;api:ApiClient;params:URLSearchParams}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[ending,setEnding]=useState(false);
  const write=user.permissions.includes("task:write"); const scanDriven=task.data_environment==="SIMULATED";
  async function start(){setBusy(true);setError("");try{await commands.run(`/tasks/${task.id}:start`,{},String(task.version));await refresh();}catch(e){setError((e as Error).message);await refresh();}finally{setBusy(false);}}
  const meta: [string,ReactNode][]=[["任务编号",taskDisplayLabel(task)],["当前盘号",data.spools.find(s=>s.id===task.spool_id)?.spool_code||"—"],["当前工单",data.orders.find(o=>o.id===task.work_order_id)?.external_code||"—"],["创建时盘号",<HashLink route={`trace?spool=${task.original_spool_id||task.spool_id}`}>{task.context_snapshot.spool_code}</HashLink>],["规格",specificationLabel(task.context_snapshot.specification)],["工序",data.catalog.inspection_process.find(p=>p.id===task.process_id)?.name||task.process_id],["检测项",names[task.metric_code]],["设备",task.device_id],["数据来源",environmentLabel(task.data_environment)],["计划长度 / m",task.planned_length_m??"未知"],["规则快照",ruleText(task.rule_snapshot)],["开始时间",labelTime(task.started_at)],["结束时间",labelTime(task.ended_at)],["任务版本",String(task.version)],["质量结论","未形成整盘质量结论"],["有效覆盖","位置未验证，暂不可计算"]];
  return <><PageTitle title="检测任务详情" subtitle={taskDisplayLabel(task)} actions={<><HashLink route={params.get("back")||"tasks"}>{params.get("back")==="dashboard"?"返回工作台":params.get("back")?.startsWith("workorders?")?"返回工单详情":params.get("back")?.startsWith("trace?")?"返回线缆详情":params.get("back")?.startsWith("history?")?"返回历史查询":params.get("back")?.includes("view=plans")?"返回批量计划":params.get("back")?.startsWith("detection?")?"返回检测":"返回任务列表"}</HashLink>{write&&!scanDriven&&task.state==="CREATED"&&<Button primary disabled={busy} onClick={()=>void start()}>开始检测</Button>}{write&&!scanDriven&&task.state==="RUNNING"&&<Button disabled={busy} onClick={()=>setEnding(true)}>结束检测</Button>}</>}/>
    {error&&<Note><span role="alert">{error}</span></Note>}<Panel core title="任务与生产快照" tools={status(task.state)}><div className="detail-grid">{meta.map(([label,value])=><div className="meta-item" key={label}><span className="muted small">{label}</span><div>{value}</div></div>)}</div><details className="ux-technical"><summary>完整任务标识</summary><p>原任务编号：{task.task_code||"未分配"}</p><p>内部ID：{task.id}</p></details></Panel>
    <Panel core title="检测与追溯">{task.simultaneous_tasks?.length? <Note>同设备同时检测两项 · {task.simultaneous_tasks.map(t=><HashLink key={t.id} route={`task?id=${t.id}`}>{names[t.metric_code]} · {t.task_code} </HashLink>)} · 统一扫码启停，各自保存结果。</Note>:null}<div className="row"><HashLink route={`detection?metric=${shortCode(task.metric_code)}&task=${task.id}`}>进入检测页面</HashLink><HashLink route={`history?task_id=${task.id}`}>查询全部历史记录</HashLink><HashLink route={`trace?spool=${task.spool_id}`}>查看同盘所有任务</HashLink><a href="http://127.0.0.1:4196" target="_blank" rel="noreferrer">打开接入工具</a></div><Note>{scanDriven&&["SHIELD_OVERLAP_RATE","WIRE_GAP"].includes(task.metric_code)?"在接入工具选择本检测设备，填写设备订单号并扫描任务码，中心自动开始检测。每次检测对应一个新订单号；换码切换任务，历史与待传数据保留。":scanDriven?"边缘开机后扫描本任务码，中心自动开始检测；扫描同设备下一任务码，自动结束当前任务并开始下一任务。边缘关机同步结束当前任务，历史与待传数据保留。":"平台开始任务后，采集端需确认绑定；同一设备下一盘必须先结束当前任务。任务结束不会删除测量历史。"}</Note></Panel>
    {["SHIELD_OVERLAP_RATE","WIRE_GAP"].includes(task.metric_code)&&<OdmSource api={api} task={task}/>}<TaskActivityPanel api={api} task={task}/><TaskProcess api={api} task={task}/><TaskAssociation {...{api,commands,task,data,user,refresh}}/>{task.end_reason&&<Note>结束原因：{task.end_reason}</Note>}
    {ending&&<Modal title="结束本次检测" open onClose={()=>setEnding(false)} submitLabel="确认结束" onSubmit={async v=>{await commands.run(`/tasks/${task.id}:end`,{reason:String(v.get("reason")).trim()},String(task.version));await refresh();}}><Field label="结束原因"><TextInput name="reason" required maxLength={1000}/></Field><Note>请先停止该设备新增采样；结束任务不表示整盘质量合格。历史和允许的迟到补传仍按原任务追溯。</Note></Modal>}
  </>;
}
export function LivePages(props:Props){
  const {route,params,api,commands,data,user,refresh}=props;
  if(['users','settings','audit'].includes(route))return <AdminRedirect route={route} params={params}/>;
  if(route==="workorders")return <WorkOrders {...props}/>;
  if(route==="tasks"){if(params.get("view")==="plans")return <PlanPages {...props}/>;if(params.get("view")==="auto")return <DiscoveryPage {...props}/>;return <ProductionTasks {...props}/>;}
  if(route==="task"||route==="detection"){
    const id=params.get(route==="task"?"id":"task"),task=data.tasks.find(t=>t.id===id);
    if(route==="detection"&&!id)return <ProductionTasks {...props} metric={params.get("metric")==="ht"?"SHEATH_THICKNESS":codes[params.get("metric")||"dg"]||codes.dg} detectionView={params.get("metric")==="ht"?"ht":undefined}/>;
    if(!task)return <Note>{props.workspaceStatus==="loading"?"正在读取任务，请稍候…":props.workspaceStatus==="failed"?"任务读取失败，请使用上方重试。":"任务不存在或不在当前账号可查看的范围内。"}<HashLink route="tasks">返回任务列表</HashLink></Note>;
    if(route==="task")return <TaskDetail {...{task,data,commands,user,refresh,api,params}}/>;
    if(params.get("metric")&&(params.get("metric")==="ht"?"SHEATH_THICKNESS":codes[params.get("metric")!])!==task.metric_code)return <Note>指标与任务不匹配。<HashLink route={`task?id=${task.id}`}>返回任务详情</HashLink></Note>;
    return <><PageTitle title={params.get("metric")==="ht"?"护套厚度检测":`${names[task.metric_code]}检测`} subtitle={`${task.task_code} · ${data.spools.find(s=>s.id===task.spool_id)?.spool_code||task.context_snapshot.spool_code} · ${task.device_id} · ${taskState[task.state]}`} actions={<><HashLink route={params.get("back")||`detection?metric=${params.get("metric")==="ht"?"ht":shortCode(task.metric_code)}`}>{params.get("back")==="dashboard"?"返回工作台":"切换任务"}</HashLink><HashLink route={`task?id=${task.id}&back=${encodeURIComponent("detection?"+params)}`}>任务详情</HashLink></>}/>{params.get("metric")==="ht"?<SheathDetection key={task.id} api={api} task={{...task,current_spool_code:data.spools.find(s=>s.id===task.spool_id)?.spool_code||task.current_spool_code,current_order_code:data.orders.find(o=>o.id===task.work_order_id)?.external_code||task.current_order_code}}/>:<Measurements key={task.id} api={api} data={data} task={task} params={params} live/>}</>;
  }
  if(route==="history")return <Measurements api={api} data={data} params={params}/>;
  if(route==="alarms")return <AnomalyRecords api={api} data={data} params={params}/>;
  if(route==="trace")return params.get("spool")?<CableTrace {...{data,commands,user,refresh,api}} id={params.get("spool")!} listBack={params.get("back")||undefined}/>:<CableList {...props}/>;
  if(route==="dashboard"){
    if(props.workspaceStatus && props.workspaceStatus!=="ready")return <><PageTitle title="工作台首页"/><Note>{props.workspaceStatus==="loading"?"正在读取任务与设备概况…":"概况暂时无法读取，请使用上方重试。"}</Note></>;
    const day=(v:string)=>new Date(v).toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});const today=day(new Date().toISOString());
    return <><PageTitle title="工作台首页" subtitle="平台实时任务与设备概况" actions={<><HashLink route="workorders">工单管理</HashLink><HashLink route="trace">登记 / 查找线缆</HashLink><HashLink route="tasks">检测任务</HashLink><HashLink route="history">查询 / 导出数据</HashLink></>}/><div className="grid cols-4"><Kpi label="今日创建任务" value={data.tasks.filter(t=>day(t.created_at)===today).length} note="Asia/Shanghai · 创建时间" icon="clipboard"/><Kpi label="今日登记线缆" value={data.spools.filter(s=>!s.canonical_spool_id&&day(s.created_at)===today).length} note="内部盘ID去重" icon="box"/><Kpi label="运行任务" value={data.tasks.filter(t=>t.state==="RUNNING").length} note="任务未结束，不代表正在采集" icon="activity"/><Kpi label="在线设备" value={data.devices.filter(d=>d.online).length} note="心跳在线不等于有效采集" icon="monitor"/></div><OperationsPage api={api} data={data} compact/></>;
  }
  if(route==="connections")return <ImportConfiguration api={api} user={user}/>;
  if(route==="monitor")return <OperationsPage api={api} data={data}/>;
  if(route==="devices"&&params.get("view")==="auto")return <DiscoveryPage {...props}/>;
  if(route==="devices")return <ManagedDevices {...props}/>;
  if(route==="metrics")return <MetricDefinitions data={data} api={api} commands={commands} user={user} refresh={refresh}/>;
  if(route==="specs")return <Specifications {...props}/>;
  if(route==="recipes")return <RecipesPage api={api} commands={commands} data={data} user={user} refresh={refresh} params={params}/>;
  if(route==="templates")return <><PageTitle title="报告管理"/><Note>此入口已移除。<HashLink route="reports">进入质量报告管理</HashLink></Note></>;
  if(route==="analytics")return <AnalyticsLivePage data={data} user={user} api={api}/>;
  if(route==="reports")return <ReportsLivePage api={api} data={data} user={user} params={params} refresh={refresh}/>;
  if(route==="report")return <ReportLiveView api={api} data={data} user={user} params={params} refresh={refresh}/>;
  const pending:Record<string,string>={
    users:'管理后台待开发：账号增改、停用、角色与工厂权限维护。当前仅登录、会话与服务端权限校验已接通。',
    settings:'管理后台待开发：默认参数、参数版本与修改审计。检测中的任务保留创建时快照；全局设置不能覆盖原始记录。',
    audit:'审计查询API已接通；管理页面的筛选、详情和导出待开发。',


    connections:'设备接入配置入口保留；根据设备协议配置采集通道。',
    mes:'MES配置入口保留，当前阶段暂不接入MES，不影响工单、任务、检测和历史查询。',sync:'MES同步监控入口保留，当前阶段暂不开展发送、对账与补偿。'
  };
  return <><PageTitle title={routeTitles[route]||"页面不存在"}/><Panel core title="待开放"><Note>{pending[route]||"此页面尚未开放。"}</Note>{["alarms","connections"].includes(route)?<HashLink route="monitor">查看采集监控</HashLink>:["mes","sync"].includes(route)?<HashLink route="devices">查看设备档案</HashLink>:<HashLink route="history">查询历史与导出数据</HashLink>}</Panel></>;
}
