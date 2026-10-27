import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {LivePages} from '../live/LivePages';
import {TaskAssociation} from '../live/TaskAssociation';
import {ApiClient,Commands,emptyWorkspace,type Task,type Workspace,type Person} from '../live/api';
let root:Root,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();});
const task={id:'t2',task_code:'202610260002',spool_id:'a',work_order_id:'wa',original_spool_id:'a',association_version:'1',version:'3',state:'ENDED',specification_id:'spec',context_snapshot:{spool_code:'盘A',external_code:'工单A'}} as Task;
const data={...emptyWorkspace,orders:[{id:'wa',external_code:'工单A',specification_id:'spec'},{id:'wb',external_code:'工单B',specification_id:'spec'},{id:'bad',specification_id:'other'}],spools:[{id:'a',spool_code:'盘A',work_order_id:'wa',version:'1'},{id:'b',spool_code:'盘B',work_order_id:'wb',version:'4'},{id:'member',spool_code:'成员盘',work_order_id:'wb',canonical_spool_id:'b',version:'1'},{id:'wrong',spool_code:'异规格',work_order_id:'bad'}]} as Workspace;
const user={permissions:['task:write']} as Person;
async function open(){await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='更正关联盘号')!.click());}
async function fill(){const select=document.querySelector<HTMLSelectElement>('select[name="target_spool_id"]')!;await act(async()=>{select.value='b';select.dispatchEvent(new Event('change',{bubbles:true}));});const input=document.querySelector<HTMLInputElement>('input[name="reason"]')!;input.value='误挂盘号，核对后更正';}
async function submit(){await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
test('only the selected task is corrected with frozen task and target versions, reason and refreshed history',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({task,changes:[]});const commands=new Commands(api),run=vi.spyOn(commands,'run').mockResolvedValue({}),refresh=vi.fn().mockResolvedValue(undefined);
 await render(<TaskAssociation {...{api,commands,task,data,user,refresh}}/>);await open();
 const options=[...document.querySelectorAll('select option')].map(o=>o.textContent).join(' ');expect(options).toContain('盘B');expect(options).not.toContain('成员盘');expect(options).not.toContain('异规格');
 await fill();expect(document.body.textContent).toContain('当前工单同步为 工单B');await submit();
 expect(run).toHaveBeenCalledWith('/tasks/t2:reassociate',{target_spool_id:'b',target_spool_version:'4',reason:'误挂盘号，核对后更正'},'3');expect(refresh).toHaveBeenCalledOnce();expect(document.querySelector('[role="dialog"]')).toBeNull();
});
test('conflict preserves dialog, reason and selected target without reporting success',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({task,changes:[]});const commands=new Commands(api),refresh=vi.fn();vi.spyOn(commands,'run').mockRejectedValue(new Error('任务已变化，请刷新后重新核对'));
 await render(<TaskAssociation {...{api,commands,task,data,user,refresh}}/>);await open();await fill();await submit();
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(document.body.textContent).toContain('任务已变化');expect(document.querySelector<HTMLInputElement>('input[name="reason"]')!.value).toBe('误挂盘号，核对后更正');expect(refresh).not.toHaveBeenCalled();
});
test('viewer can read immutable correction history but cannot correct',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({task,changes:[{id:'c',association_version:'2',task_version:'4',before_context:{spool_id:'a',spool_code:'原盘A',external_code:'原工单A'},after_context:{spool_id:'b',spool_code:'当时盘B',external_code:'工单B'},reason:'核对原始记录',actor_id:'operator',request_id:'request1',occurred_at:'2026-10-26T01:02:03.123456Z'}]});
 await render(<TaskAssociation api={api} commands={new Commands(api)} task={task} data={data} user={{permissions:['data:read']} as Person} refresh={async()=>{}}/>);
 expect(container.textContent).toContain('核对原始记录');expect(container.textContent).toContain('原盘A');expect(container.textContent).toContain('request1');expect(container.textContent).not.toContain('更正关联盘号');
});
test('running task and history-load failure do not expose an enabled correction command',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockRejectedValue(new Error('服务暂不可用'));
 await render(<TaskAssociation api={api} commands={new Commands(api)} task={{...task,state:'RUNNING'}} data={data} user={user} refresh={async()=>{}}/>);
 expect(container.textContent).toContain('服务暂不可用');expect(container.textContent).not.toContain('更正关联盘号');
});

test('dashboard, device monitor and task list all show corrected current ownership',async()=>{
 const api=new ApiClient(),current={...task,state:'RUNNING',spool_id:'b',work_order_id:'wb',device_id:'device',metric_code:'SHIELD_OVERLAP_RATE',rule_snapshot:{comparison:null},context_snapshot:{...task.context_snapshot,specification:{id:'spec'}}} as any;
 const workspace={...data,tasks:[current],catalog:{...data.catalog,production_line:[{id:'line',name:'产线'}],device:[{id:'device',line_id:'line',metric_code:'SHIELD_OVERLAP_RATE'}]}} as Workspace;
 vi.spyOn(api,'request').mockResolvedValue({connections:[],tasks:[{...current,current_spool_code:'盘B',current_order_code:'工单B'}],items:[{...current,current_spool_code:'盘B'}],total:1,spools:1,running:1,ended:0,waiting:0});
 const props={api,commands:new Commands(api),data:workspace,user,refresh:async()=>{},params:new URLSearchParams()};
 await render(<LivePages {...props} route="dashboard"/>);expect(container.textContent).toContain('盘B');expect(container.textContent).toContain('工单B');expect(container.textContent).not.toContain('盘A');
 await act(async()=>root.render(<LivePages {...props} route="monitor"/>));expect(container.textContent).toContain('盘B');expect(container.textContent).not.toContain('盘A');
 await act(async()=>root.render(<LivePages {...props} route="tasks"/>));expect(container.textContent).toContain('盘B');expect(container.textContent).toContain('工单B');expect(container.textContent).not.toContain('工单A');
});
