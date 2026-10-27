import {ExecutionSummary,taskDisplayLabel} from './ExecutionSummary';
import {useState,useEffect} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {HashLink} from '../ui/HashLink';
import {Note} from '../ui/Note';
import {Button} from '../ui/Button';
import {Field} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {useRead} from './ServerLists';
import {ActivityStatus,communicationNames} from './ActivityStatus';
import {names,labelTime,taskState,environmentLabel,type Workspace,type ApiClient,type Commands,type Person,type Task,type DeviceStatus,type Specification} from './api';
export function OperationsPage({api,data,compact=false}:{api:ApiClient;data:Workspace;compact?:boolean}){
 const [tick,setTick]=useState(0);useEffect(()=>{const t=setInterval(()=>setTick(n=>n+1),5000);return()=>clearInterval(t);},[]);
 const {value,error}=useRead<{as_of:string;connections:DeviceStatus[];tasks:Task[]}>(api,'/operations/overview',tick);
 if(compact)return <Panel core title="当前执行摘要" tools={<HashLink route="monitor">查看完整采集监控</HashLink>}>
 {error?<Note>摘要读取失败：{error}</Note>:!value?<Note>正在读取执行摘要…</Note>:<>
 <ExecutionSummary tasks={value.tasks} data={data} asOf={value.as_of}/>
 </>}
 </Panel>;

 return <>{!compact&&<PageTitle title="产线与采集监控" subtitle="任务执行、设备心跳、采样接收分别展示" actions={<Button onClick={()=>setTick(n=>n+1)}>刷新监控</Button>}/>}
 {error&&<Note><span role="alert">监控读取失败：{error}</span></Note>}
 {!value&&!error&&<Note>正在读取监控…</Note>}
 {value&&<><Note>更新于{labelTime(value.as_of)} · 每5秒刷新；30秒观察窗不代表生产报警限值。通信在线不等于采样有效，运行任务不会因离线自动结束。</Note>
 {data.catalog.production_line.map(line=><Panel core table key={line.id} title={line.name}><DataTable className="b3r4-status-table" headers={['设备 / 检测项','任务 / 盘号','执行状态','通信与采样','末次接收的值 / 来源时间','设备资料']} rows={data.catalog.device.filter(d=>d.line_id===line.id).map(d=>{const t=value.tasks.find(t=>t.device_id===d.id),c=value.connections.find(c=>c.device_id===d.id),last=t?.activity?.latest;return [<>{d.name||d.id}<div>{names[d.metric_code]} · {environmentLabel(d.data_environment)}</div></>,t?<><HashLink route={'task?id='+t.id}>{taskDisplayLabel(data.tasks.find(task=>task.id===t.id)||t)}</HashLink><div>{t.current_spool_code}</div><HashLink route={"workorders?id="+t.work_order_id}>{t.current_order_code}</HashLink></>:'无运行任务',t?taskState[t.state]:'空闲',t?<ActivityStatus activity={t.activity}/>:<>{communicationNames[c?c.online?'ONLINE':'OFFLINE':'UNKNOWN']}<div>心跳：{labelTime(c?.last_heartbeat_at)}</div></>,last?<>{last.value??'—'} {last.unit}<div>{labelTime(last.sample_time)}</div></>:'无当前任务采样',<HashLink route={'devices?id='+d.id}>查看档案</HashLink>];})}/></Panel>)}
 </>}
 </>;
}
export function DeviceCatalog({data,id}:{data:Workspace;id?:string|null}){
 const selected=id?data.catalog.device.find(d=>d.id===id):undefined;
 return <><PageTitle title={id?'设备档案详情':'设备档案'} subtitle="设备基础资料；通信和采样状态统一在综合监控查看" actions={<><HashLink route="monitor">查看采集监控</HashLink><HashLink route="devices?view=auto">自动发现配置</HashLink></>}/>
 {id&&!selected?<Note>设备不存在、尚在加载或无权限。<HashLink route="devices">返回设备档案</HashLink></Note>:<Panel core table title="设备基础资料"><DataTable headers={['设备编号 / 名称','型号','检测项','产线 / 工序','来源 / 启用','操作']} rows={(selected?[selected]:data.catalog.device).map(d=>[<>{d.id}<div>{d.name}</div></>,d.model,names[d.metric_code],<>{data.catalog.production_line.find(l=>l.id===d.line_id)?.name||d.line_id}<div>{data.catalog.inspection_process.find(p=>p.id===d.process_id)?.name||d.process_id}</div></>,<>{environmentLabel(d.data_environment)} · {d.enabled?'启用':'停用'}</>,<HashLink route={selected?'devices':'devices?id='+d.id}>{selected?'返回列表':'设备详情'}</HashLink>])}/></Panel>}
 <Note>设备基础资料可在详情维护；协议能力版本、校准与维护记录待开放；现有资料来自平台目录，不代表真机能力已验收。</Note></>;
}
type MetricSpec=Specification&{version:string;cable_model?:string|null;customer_code?:string|null;product_type?:string|null;description?:string|null;applicability?:{process_id:string;metric_code:string}[]};
function MetricApplicabilityEditor({metric,name,data,api,commands,refresh,onClose}:{metric:string;name:string;data:Workspace;api:ApiClient;commands:Commands;refresh:()=>Promise<void>;onClose:()=>void}){
 const specs=data.catalog.product_specification;
 const processIds=[...new Set(data.catalog.device.filter(d=>d.metric_code===metric).map(d=>d.process_id))];
 const initiallySelected=new Set(data.catalog.specification_applicability.filter(a=>a.metric_code===metric).map(a=>a.specification_id));
 const [selected,setSelected]=useState(initiallySelected),[saving,setSaving]=useState(false);
 const selectAll=()=>setSelected(new Set(specs.map(s=>s.id)));
 const clear=()=>setSelected(new Set());
 return <Modal title={`${name} · 适用产品规格`} open onClose={onClose} onSubmit={async form=>{
  const changed=specs.filter(s=>selected.has(s.id)!==initiallySelected.has(s.id));
  if(!changed.length)return;
  if(selected.size&&!processIds.length)throw new Error(`当前没有关联${name}的接入工序，暂时无法保存。请先在设备档案中配置检测项与工序。`);
  setSaving(true);
  const reason=String(form.get('reason')||'').trim();
  try{
   const details=await Promise.all(changed.map(s=>api.request<MetricSpec>(`/catalog/specifications/${encodeURIComponent(s.id)}`)));
   const plans=details.map(spec=>{
    const current=spec.applicability||[];
    const next=selected.has(spec.id)
     ? [...current,...processIds.filter(processId=>!current.some(a=>a.process_id===processId&&a.metric_code===metric)).map(process_id=>({process_id,metric_code:metric}))]
     : current.filter(a=>a.metric_code!==metric);
    const unique=[...new Map(next.map(a=>[`${a.process_id}|${a.metric_code}`,a])).values()];
    if(!unique.length)throw new Error(`${spec.code||spec.id}至少要保留一个适用工序和检测项。可先在规格档案中添加其他检测项，再移除此项。`);
    return {spec,applicability:unique};
   });
   let completed=0;
   try{
    for(const plan of plans){
     await commands.run(`/catalog/specifications/${encodeURIComponent(plan.spec.id)}`,{
      code:plan.spec.code||'',name:plan.spec.name,voltage_kv:plan.spec.voltage_kv,conductor_area_mm2:plan.spec.conductor_area_mm2,core_count:plan.spec.core_count,
      shield_structure:plan.spec.shield_structure,enabled:plan.spec.enabled,cable_model:plan.spec.cable_model||'',customer_code:plan.spec.customer_code||'',product_type:plan.spec.product_type||'',description:plan.spec.description||'',
      applicability:plan.applicability,reason
     },String(plan.spec.version));
     completed++;
    }
   }catch(error){
    await refresh();
    throw new Error(`${completed?`已保存 ${completed}/${plans.length} 项；`:'未保存任何项；'}请刷新后核对适用规格再重试。${error instanceof Error?` ${error.message}`:''}`);
   }
   await refresh();
  }finally{setSaving(false);}
 }}>
  <Note>勾选后会同步写入产品规格档案，并关联当前已接入此检测项的工序；取消勾选会移除此规格的该检测项关系，其他检测项保留。所有变更都会生成规格新版本并记录原因。</Note>
  <div className="row"><Button disabled={saving} onClick={selectAll}>全选规格</Button><Button disabled={saving} onClick={clear}>清空本项</Button><span>已选 {selected.size} / {specs.length}</span></div>
  {!specs.length?<Note>当前没有产品规格档案。</Note>:<fieldset disabled={saving} className="metric-applicability-list"><legend>适用产品规格</legend>{specs.map(spec=><label key={spec.id} style={{display:'block',margin:'8px 0'}}><input type="checkbox" checked={selected.has(spec.id)} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(spec.id);else next.delete(spec.id);return next;})}/><strong>{spec.code||spec.id}</strong> · {spec.name} · {spec.voltage_kv} kV · {spec.conductor_area_mm2} mm² · {spec.core_count}芯{!spec.enabled?'（停用）':''}</label>)}</fieldset>}
  <Field label="修改原因"><input name="reason" required maxLength={500} placeholder={`例如：测试阶段调整${name}的适用规格`}/></Field>
  <Note>测试模式允许三项检测指标均可选，不代表已经批准相应产品结构或生产适用性。每个规格至少保留一项适用关系。</Note>
 </Modal>;
}
export function MetricDefinitions({data,api,commands,user,refresh}:{data:Workspace;api?:ApiClient;commands?:Commands;user?:Person;refresh?:()=>Promise<void>}){
 const [editing,setEditing]=useState<{metric:string;name:string}|null>(null),write=Boolean(user?.permissions.includes('catalog:write')&&api&&commands&&refresh);
 return <><PageTitle title="三项检测指标" subtitle="指标定义和适用范围；判定阈值统一由配方管理" actions={<HashLink route="recipes">查看配方与规则</HashLink>}/>
 <Panel core table title="指标与适用关系"><DataTable headers={['检测项','当前接入单位','关联设备','适用规格','规则入口',...(write?['规格设置']:[])]} rows={Object.entries(names).map(([code,name])=>{
  const deviceIds=data.catalog.device.filter(d=>d.metric_code===code).map(d=>d.id);
  const specIds=[...new Set(data.catalog.specification_applicability.filter(a=>a.metric_code===code).map(a=>a.specification_id))];
  const specs=specIds.map(id=>data.catalog.product_specification.find(s=>s.id===id)?.code||id);
  return [name,code==='WIRE_GAP'?'mm':'%',deviceIds.join('、')||'未配置',specs.join('、')||'未配置',<HashLink route={`recipes?metric_code=${code}`}>配方与判定规则</HashLink>,...(write?[<Button onClick={()=>setEditing({metric:code,name})}>选择产品规格</Button>]:[])];
 })}/></Panel>
 <Note>设备相关子项及生产规则以本地参考资料、实际交付型号和批准规则为准；当前TEST_ONLY规则只用于模拟联调。不圆度1.0接口使用%，原件存在mm定义，需版本化适配，不能直接换算或混用。</Note>
 {write&&<Note>产品规格与检测项的选择在本页和规格档案双向同步；修改会生成规格版本。仅供当前测试环境使用，不代表生产适用性批准。</Note>}
 {editing&&api&&commands&&refresh&&<MetricApplicabilityEditor key={editing.metric} {...editing} data={data} api={api} commands={commands} refresh={refresh} onClose={()=>setEditing(null)}/>}
 </>;
}
