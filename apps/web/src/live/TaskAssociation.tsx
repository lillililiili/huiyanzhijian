import {useEffect,useState} from 'react';
import {Panel} from '../ui/Panel';
import {Button} from '../ui/Button';
import {Modal} from '../ui/Modal';
import {Field,TextInput} from '../ui/Field';
import {Note} from '../ui/Note';
import {DataTable} from '../ui/DataTable';
import {HashLink} from '../ui/HashLink';
import {labelTime,type ApiClient,type Commands,type Person,type Task,type Workspace,type Spool} from './api';

interface ChangeContext {spool_id:string;spool_code:string;work_order_id:string;external_code:string}
interface Change {id:string;association_version:string;task_version:string;before_context:ChangeContext;after_context:ChangeContext;reason:string;actor_id:string;request_id:string;occurred_at:string}
interface History {task:Task;changes:Change[]}
export function TaskAssociation({api,commands,task,data,user,refresh}:{api:ApiClient;commands:Commands;task:Task;data:Workspace;user:Person;refresh:()=>Promise<void>}){
 const [history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [editing,setEditing]=useState<{task:Task;targets:Spool[]}|null>(null),[target,setTarget]=useState('');
 useEffect(()=>{let active=true;setHistory(null);setError('');api.request<History>(`/task-associations/${task.id}`).then(r=>{if(active)setHistory(r);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[api,task.id,task.version,reload]);
 const current=history?.task||task;
 const eligible=data.spools.filter(s=>s.id!==current.spool_id&&!s.canonical_spool_id&&data.orders.find(o=>o.id===s.work_order_id)?.specification_id===current.specification_id);
 const selected=editing?.targets.find(s=>s.id===target);
 const display=(c:ChangeContext)=><><HashLink route={`trace?spool=${c.spool_id}`}>{c.spool_code}</HashLink><div>{c.external_code}</div><small>{c.spool_id}</small></>;
 return <Panel core title="盘号关联更正" tools={<>{user.permissions.includes('task:write')&&['CREATED','ENDED'].includes(current.state)&&<Button disabled={!history||!eligible.length} onClick={()=>{setEditing({task:current,targets:eligible.map(s=>({...s}))});setTarget('');}}>更正关联盘号</Button>}<Button onClick={()=>setReload(n=>n+1)}>刷新更正履历</Button></>}>
  <Note>仅更正本任务的当前归属；其他任务、创建快照、采样原文和设备绑定保留。检测中、已取消或尚未完成出料的任务不能更正。</Note>
  {error?<Note><span role="alert">{error}</span></Note>:!history?<p>正在读取更正履历…</p>:<><p>关联版本：{current.association_version||'1'} · 创建时盘号：{current.context_snapshot.spool_code} · 创建时工单：{current.context_snapshot.external_code}</p>
   {history.changes.length?<DataTable headers={['关联 / 任务版本','更正前盘号 / 工单','更正后盘号 / 工单','原因','操作人 / 时间（北京时间）','请求ID']} rows={history.changes.map(c=>[`${c.association_version} / ${c.task_version}`,display(c.before_context),display(c.after_context),c.reason,<>{c.actor_id}<div>{labelTime(c.occurred_at)}</div></>,c.request_id])}/>:<p className="muted">尚无关联更正记录。</p>}</>}
  {editing&&<Modal title="更正单个任务关联盘号" open onClose={()=>setEditing(null)} submitLabel="确认更正" onSubmit={async values=>{
   const to=editing.targets.find(s=>s.id===String(values.get('target_spool_id')));if(!to)throw Error('请选择目标盘');
   const reason=String(values.get('reason')||'').trim();if(!reason)throw Error('请填写更正原因');
   await commands.run(`/tasks/${editing.task.id}:reassociate`,{target_spool_id:to.id,target_spool_version:String(to.version),reason},String(editing.task.version));
   setEditing(null);setReload(n=>n+1);try{await refresh();}catch{setError("更正已保存，工作区刷新失败，请刷新页面核对。");}
  }}>
   <p>任务：{editing.task.task_code} · 当前盘：{data.spools.find(s=>s.id===editing.task.spool_id)?.spool_code} · 当前工单：{data.orders.find(o=>o.id===editing.task.work_order_id)?.external_code}</p>
   <Field label="目标盘号"><select name="target_spool_id" aria-label="目标盘号" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">请选择同规格主盘</option>{editing.targets.map(s=><option key={s.id} value={s.id}>{s.spool_code} · {data.orders.find(o=>o.id===s.work_order_id)?.external_code}</option>)}</select></Field>
   {selected&&<Note>更正后：{selected.spool_code}；当前工单同步为 {data.orders.find(o=>o.id===selected.work_order_id)?.external_code}。仅此任务及其历史测量从原盘汇总移入目标盘；原计划申请、过料事件和物料识别映射保留。</Note>}
   <Field label="更正原因"><TextInput name="reason" aria-label="更正原因" required maxLength={1000}/></Field>
   <Note>若提示任务或目标盘已变化，请关闭弹窗、刷新后重新核对。需要撤回时，再次更正并填写原因；已有履历不删除。</Note>
  </Modal>}
 </Panel>;
}
