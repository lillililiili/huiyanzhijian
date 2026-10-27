import {useState} from 'react';
import {WorkOrderDelete} from './WorkOrderDelete';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {Field} from '../ui/Field';
import {Button} from '../ui/Button';
import {Note} from '../ui/Note';
import {HashLink} from '../ui/HashLink';
import {navigate} from '../app/hashRoute';
import {useRead,ServerList,cableStates} from './ServerLists';
import {ProductionTasks,type ProductionProps} from './ProductionPages';
import {WorkOrderForm,SpoolForm,TaskForm} from './TaskForms';
import {labelTime,specificationLabel} from './api';
export function WorkOrders(props:ProductionProps){
 const {api,data,params,commands,user,refresh}=props,id=params.get('id'),[tick,setTick]=useState(0),[modal,setModal]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const q=new URLSearchParams();for(const k of ['q','state','specification_id','from','to','page','limit'])if(params.get(k))q.set(k,params.get(k)!);
 const {value,error:readError}=useRead<any>(api,id?'/work-order-summaries/'+id:'/production/work-orders?'+q,tick);
 async function reload(){await refresh();setTick(n=>n+1);}
 async function open(name:string){setBusy(true);setError('');try{if(name!=='order')await (props.prepareForms||refresh)();setModal(name);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const write=user.permissions.includes('task:write'),back='workorders?'+params,detailParams=new URLSearchParams(params);if(id)detailParams.set('work_order_id',id);
 function page(n:number){q.set('page',String(n));navigate('workorders?'+q);}
 async function deleted(){
  setNotice('工单已删除，后台操作审计已记录。');setError('');
  if(id)navigate(params.get('back')||'workorders');
  else if(value?.items.length===1&&value.page>1)page(value.page-1);
  setTick(n=>n+1);
  try{await refresh();}catch{setError('工单已删除，但关联列表刷新失败，请刷新页面核对。');}
 }

 return <><PageTitle title={id?'工单详情':'工单管理'} subtitle="工单组织生产需求，线缆聚合检测结果，任务记录一次执行" actions={<><Button onClick={()=>setTick(n=>n+1)}>刷新工单</Button>{id?<HashLink route={params.get('back')||'workorders'}>返回工单列表</HashLink>:write&&<Button primary onClick={()=>void open('order')}>新建工单</Button>}</>}/>
 {notice&&<Note><span role="status">{notice}</span></Note>}
 {busy&&<Note>正在加载表单资料…</Note>}{(error||readError)&&<Note><span role="alert">{error||readError}</span></Note>}
 {!id&&<form key={params.toString()} className="filters" onSubmit={e=>{e.preventDefault();const q=new URLSearchParams();new FormData(e.currentTarget).forEach((v,k)=>{if(String(v))q.set(k,String(v));});navigate('workorders?'+q);}}><Field label="工单编号"><input name="q" defaultValue={params.get('q')||''}/></Field><Field label="执行状态"><select name="state" defaultValue={params.get('state')||''}><option value="">全部</option>{Object.entries(cableStates).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="规格"><select name="specification_id" defaultValue={params.get('specification_id')||''}><option value="">全部规格</option>{data.catalog.product_specification.map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field><Field label="每页"><select name="limit" defaultValue={params.get('limit')||'20'}>{[20,50,100].map(n=><option key={n}>{n}</option>)}</select></Field><Button primary type="submit">查询</Button><HashLink route="workorders">重置</HashLink></form>}
 {!value&&!readError&&<Note>正在读取工单…</Note>}
 {value&&!id&&<Panel core table title={`工单列表 · 筛选内${value.total}单`}><DataTable headers={['工单 / 来源','规格','登记身份 / 物理盘','任务 / 待开始 / 运行 / 结束 / 取消','执行状态','创建时间（北京时间）','操作']} rows={value.items.map((w:any)=>[<>{w.external_code}<div className="muted small">{w.source_system==='PLATFORM'?'平台录入':w.source_system==='AUTO'?'自动发现':w.source_system}</div></>,specificationLabel(data.catalog.product_specification.find(s=>s.id===w.specification_id)),`${w.registered_spools} / ${w.physical_spools}`,`${w.task_count} / ${w.waiting_count} / ${w.running_count} / ${w.ended_count} / ${w.cancelled_count}`,cableStates[w.state],labelTime(w.created_at),<div className="work-order-actions"><HashLink route={`workorders?id=${w.id}&back=${encodeURIComponent(back)}`}>工单详情</HashLink>{write&&<WorkOrderDelete order={w} commands={commands} disabled={Boolean(readError)} onDeleted={deleted}/>}</div>])}/><div className="row"><Button disabled={value.page<=1} onClick={()=>page(value.page-1)}>上一页</Button><span>第{value.page}页 / {Math.max(1,Math.ceil(value.total/value.limit))}页</span><Button disabled={value.page*value.limit>=value.total} onClick={()=>page(value.page+1)}>下一页</Button></div></Panel>}
 {value&&id&&<><Panel core title={value.external_code}><div className="detail-grid"><div>规格：{specificationLabel(data.catalog.product_specification.find(s=>s.id===value.specification_id))}</div><div>来源：{value.source_system==='PLATFORM'?'平台录入':value.source_system==='AUTO'?'自动发现':value.source_system}</div><div>创建：{labelTime(value.created_at)}</div><div>登记身份：{value.registered_spools} · 物理盘：{value.physical_spools}</div><div>当前任务：{value.task_count} · 待开始{value.waiting_count} · 运行{value.running_count} · 结束{value.ended_count} · 取消{value.cancelled_count}</div><div>执行状态：{cableStates[value.state]}</div></div>{write&&<div className="row"><Button disabled={busy} onClick={()=>void open('spool')}>登记线缆</Button><Button primary disabled={busy} onClick={()=>void open('task')}>分配检测任务</Button><WorkOrderDelete order={value} commands={commands} disabled={Boolean(readError)} onDeleted={deleted}/></div>}<Note>任务按当前工单统计；原始创建归属在任务详情保留。登记身份包括已归并成员，物理盘按主盘去重；下方线缆汇总包含同盘其他工单任务。执行结束不等于质量合格。</Note></Panel><div className="row b3-tabs"><HashLink aria-current={params.get("tab")!=="tasks"?"page":undefined} route={`workorders?id=${id}&tab=spools&back=${encodeURIComponent(params.get('back')||'workorders')}`}>关联线缆</HashLink><HashLink aria-current={params.get("tab")==="tasks"?"page":undefined} route={`workorders?id=${id}&tab=tasks&back=${encodeURIComponent(params.get('back')||'workorders')}`}>检测任务</HashLink></div>
 {params.get('tab')==='tasks'?<ProductionTasks {...props} scopeSpec={value.specification_id} params={detailParams} embedded context={{route:'workorders',params:{id,tab:'tasks',work_order_id:id,back:params.get('back')||'workorders'}}}/>:<ServerList scopeSpec={value.specification_id} api={api} data={data} params={detailParams} kind="spools" revision={tick} context={{route:'workorders',params:{id,tab:'spools',work_order_id:id,back:params.get('back')||'workorders'}}}/>}</>}
 {modal==='order'&&<WorkOrderForm {...{data,commands}} close={()=>setModal('')} refresh={reload} onCreated={w=>navigate('workorders?id='+w.id)}/>}
 {modal==='spool'&&<SpoolForm {...{data,commands}} initialOrder={id||undefined} close={()=>setModal('')} refresh={reload}/>}
 {modal==='task'&&<TaskForm {...{data,commands}} initialOrder={id||undefined} close={()=>setModal('')} refresh={reload}/>}
 </>;
}

