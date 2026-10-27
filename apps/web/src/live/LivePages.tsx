import {RecipesPage} from './RecipesPage';
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
  const write=user.permissions.includes("task:write");
  async function start(){setBusy(true);setError("");try{await commands.run(`/tasks/${task.id}:start`,{},String(task.version));await refresh();}catch(e){setError((e as Error).message);await refresh();}finally{setBusy(false);}}
  const meta: [string,ReactNode][]=[["任务编号",taskDisplayLabel(task)],["当前盘号",data.spools.find(s=>s.id===task.spool_id)?.spool_code||"—"],["当前工单",data.orders.find(o=>o.id===task.work_order_id)?.external_code||"—"],["创建时盘号",<HashLink route={`trace?spool=${task.original_spool_id||task.spool_id}`}>{task.context_snapshot.spool_code}</HashLink>],["规格",specificationLabel(task.context_snapshot.specification)],["工序",data.catalog.inspection_process.find(p=>p.id===task.process_id)?.name||task.process_id],["检测项",names[task.metric_code]],["设备",task.device_id],["数据来源",environmentLabel(task.data_environment)],["计划长度 / m",task.planned_length_m??"未知"],["规则快照",ruleText(task.rule_snapshot)],["开始时间",labelTime(task.started_at)],["结束时间",labelTime(task.ended_at)],["任务版本",String(task.version)],["质量结论","未形成整盘质量结论"],["有效覆盖","位置未验证，暂不可计算"]];
  return <><PageTitle title="检测任务详情" subtitle={taskDisplayLabel(task)} actions={<><HashLink route={params.get("back")||"tasks"}>{params.get("back")==="dashboard"?"返回工作台":params.get("back")?.startsWith("workorders?")?"返回工单详情":params.get("back")?.startsWith("trace?")?"返回线缆详情":params.get("back")?.startsWith("history?")?"返回历史查询":params.get("back")?.includes("view=plans")?"返回批量计划":params.get("back")?.startsWith("detection?")?"返回检测":"返回任务列表"}</HashLink>{write&&task.state==="CREATED"&&<Button primary disabled={busy} onClick={()=>void start()}>开始检测</Button>}{write&&task.state==="RUNNING"&&<Button disabled={busy} onClick={()=>setEnding(true)}>结束检测</Button>}</>}/>
    {error&&<Note><span role="alert">{error}</span></Note>}<Panel core title="任务与生产快照" tools={status(task.state)}><div className="detail-grid">{meta.map(([label,value])=><div className="meta-item" key={label}><span className="muted small">{label}</span><div>{value}</div></div>)}</div><details className="ux-technical"><summary>完整任务标识</summary><p>原任务编号：{task.task_code||"未分配"}</p><p>内部ID：{task.id}</p></details></Panel>
    <Panel core title="检测与追溯"><div className="row"><HashLink route={`detection?metric=${shortCode(task.metric_code)}&task=${task.id}`}>进入检测页面</HashLink><HashLink route={`history?task_id=${task.id}`}>查询全部历史记录</HashLink><HashLink route={`trace?spool=${task.spool_id}`}>查看同盘所有任务</HashLink><a href="http://127.0.0.1:4196" target="_blank" rel="noreferrer">打开本地模拟器</a></div><Note>平台开始任务后，采集端需确认绑定；同一设备下一盘必须先结束当前任务。任务结束不会删除测量历史。</Note></Panel>
    <TaskActivityPanel api={api} task={task}/><TaskProcess api={api} task={task}/><TaskAssociation {...{api,commands,task,data,user,refresh}}/>{task.end_reason&&<Note>结束原因：{task.end_reason}</Note>}
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
    if(route==="detection"&&!id)return <ProductionTasks {...props} metric={codes[params.get("metric")||"dg"]||codes.dg}/>;
    if(!task)return <Note>{props.workspaceStatus==="loading"?"正在读取任务，请稍候…":props.workspaceStatus==="failed"?"任务读取失败，请使用上方重试。":"任务不存在或不在当前账号可查看的范围内。"}<HashLink route="tasks">返回任务列表</HashLink></Note>;
    if(route==="task")return <TaskDetail {...{task,data,commands,user,refresh,api,params}}/>;
    if(params.get("metric")&&codes[params.get("metric")!]!==task.metric_code)return <Note>指标与任务不匹配。<HashLink route={`task?id=${task.id}`}>返回任务详情</HashLink></Note>;
    return <><PageTitle title={`${names[task.metric_code]}检测`} subtitle={`${task.task_code} · ${data.spools.find(s=>s.id===task.spool_id)?.spool_code||task.context_snapshot.spool_code} · ${task.device_id} · ${taskState[task.state]}`} actions={<><HashLink route={params.get("back")||`detection?metric=${shortCode(task.metric_code)}`}>{params.get("back")==="dashboard"?"返回工作台":"切换任务"}</HashLink><HashLink route={`task?id=${task.id}&back=${encodeURIComponent("detection?"+params)}`}>任务详情</HashLink></>}/><Measurements key={task.id} api={api} data={data} task={task} params={params} live/></>;
  }
  if(route==="history")return <Measurements api={api} data={data} params={params}/>;
  if(route==="alarms")return <AnomalyRecords api={api} data={data} params={params}/>;
  if(route==="trace")return params.get("spool")?<CableTrace {...{data,commands,user,refresh,api}} id={params.get("spool")!} listBack={params.get("back")||undefined}/>:<CableList {...props}/>;
  if(route==="dashboard"){
    if(props.workspaceStatus && props.workspaceStatus!=="ready")return <><PageTitle title="工作台首页"/><Note>{props.workspaceStatus==="loading"?"正在读取任务与设备概况…":"概况暂时无法读取，请使用上方重试。"}</Note></>;
    const day=(v:string)=>new Date(v).toLocaleDateString("en-CA",{timeZone:"Asia/Shanghai"});const today=day(new Date().toISOString());
    return <><PageTitle title="工作台首页" subtitle="平台实时任务与设备概况" actions={<><HashLink route="workorders">工单管理</HashLink><HashLink route="trace">登记 / 查找线缆</HashLink><HashLink route="tasks">检测任务</HashLink><HashLink route="history">查询 / 导出数据</HashLink></>}/><div className="grid cols-4"><Kpi label="今日创建任务" value={data.tasks.filter(t=>day(t.created_at)===today).length} note="Asia/Shanghai · 创建时间" icon="clipboard"/><Kpi label="今日登记线缆" value={data.spools.filter(s=>!s.canonical_spool_id&&day(s.created_at)===today).length} note="内部盘ID去重" icon="box"/><Kpi label="检测中任务" value={data.tasks.filter(t=>t.state==="RUNNING").length} note="全部运行任务" icon="activity"/><Kpi label="在线设备" value={data.devices.filter(d=>d.online).length} note="心跳在线不等于有效采集" icon="monitor"/></div><OperationsPage api={api} data={data} compact/></>;
  }
  if(route==="monitor")return <OperationsPage api={api} data={data}/>;
  if(route==="devices"&&params.get("view")==="auto")return <DiscoveryPage {...props}/>;
  if(route==="devices")return <ManagedDevices {...props}/>;
  if(route==="metrics")return <MetricDefinitions data={data} api={api} commands={commands} user={user} refresh={refresh}/>;
  if(route==="specs")return <Specifications {...props}/>;
  if(route==="recipes")return <RecipesPage api={api} commands={commands} data={data} user={user} refresh={refresh} params={params}/>;
  const pending:Record<string,string>={
    users:'管理后台待开发：账号增改、停用、角色与工厂权限维护。当前仅登录、会话与服务端权限校验已接通。',
    settings:'管理后台待开发：默认参数、参数版本与修改审计。检测中的任务保留创建时快照；全局设置不能覆盖原始记录。',
    audit:'审计查询API已接通；管理页面的筛选、详情和导出待开发。',
    reports:'正式报告生成、审核、发布与版本追溯待开发；原始记录导出请进入历史查询。',
    analytics:'区段、覆盖率和质量统计待开发；现有样本数量不能替代按长度合格率。',
    connections:'设备接入配置入口保留；当前使用模拟器验证业务流程，真实设备接入暂不开展。',
    mes:'MES配置入口保留，当前阶段暂不接入MES，不影响工单、任务、检测和历史查询。',sync:'MES同步监控入口保留，当前阶段暂不开展发送、对账与补偿。',
    import:'文件导入、人工补录和更正审批待开发；设备断网补传走已有接入契约。',templates:'报告模板维护与受控版本待开发。'
  };
  return <><PageTitle title={routeTitles[route]||"页面不存在"}/><Panel core title="待开放"><Note>{pending[route]||"此页面尚未开放。"}</Note>{["alarms","connections"].includes(route)?<HashLink route="monitor">查看采集监控</HashLink>:["mes","sync"].includes(route)?<HashLink route="devices">查看设备档案</HashLink>:<HashLink route="history">查询历史与导出数据</HashLink>}</Panel></>;
}
