import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {PlanPages,ProductionTasks} from '../live/ProductionPages';
import {Measurements} from '../live/Measurements';
import {ApiClient,Commands,emptyWorkspace,type Workspace,type Person} from '../live/api';
let root:Root,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();});
const user:Person={id:'user',name:'test',username:'test',factory_id:'factory',permissions:['data:read','task:write']};
test('plan partial failure stays visible and retries only selected stable item',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({id:'plan',name:'mixed',items:[{id:'good',request:{spool_id:'s1',device_id:'d1'},task:{id:'task',task_code:'202610260001',state:'RUNNING'}},{id:'failed',request:{spool_id:'s2',device_id:'d1'},task:{id:'task2',task_code:'202610260002',state:'CREATED'},last_error:{message:'设备已有运行任务'}}]});
 const commands=new Commands(api),run=vi.spyOn(commands,'run').mockResolvedValue({results:[{status:'FAILED'}]});
 await render(<PlanPages api={api} commands={commands} data={emptyWorkspace} user={user} refresh={async()=>{}} params={new URLSearchParams('view=plans&plan=plan')}/>);
 expect(container.textContent).toContain('设备已有运行任务');expect(container.textContent).toContain('尚未全部结束');
 const start=[...container.querySelectorAll('button')].find(b=>b.textContent==='开始此项')!;await act(async()=>start.click());expect(run).toHaveBeenCalledWith('/plans/plan:start',{item_id:'failed'});expect(request).toHaveBeenCalledTimes(2);
});
test('task query carries filters and shows whole-result counts for a one-row page; viewer cannot create',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[],total:42,running:2,ended:20,waiting:20,spools:7,page:2});
 await render(<ProductionTasks api={api} commands={new Commands(api)} data={emptyWorkspace} user={{...user,permissions:['data:read']}} refresh={async()=>{}} params={new URLSearchParams('q=coil&state=RUNNING&page=2')}/>);
 expect(String(request.mock.calls[0][0])).toContain('q=coil&state=RUNNING&page=2&limit=20');expect(container.textContent).toContain('筛选内 42 任务');expect(container.textContent).not.toContain('新建检测任务');
});
test('grouped cable history requests member tasks without rewriting raw task identity',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[],has_more:false,next_cursor:null});
 const data={...emptyWorkspace,spools:[{id:'root',spool_code:'A',work_order_id:'wo',created_at:''},{id:'child',canonical_spool_id:'root',spool_code:'B',work_order_id:'wo',created_at:''}],tasks:[{id:'t-root',spool_id:'root',context_snapshot:{}},{id:'t-child',spool_id:'child',context_snapshot:{}}]} as Workspace;
 await render(<Measurements api={api} data={data} params={new URLSearchParams('spool=root')}/>);
 const query=new URLSearchParams(String(request.mock.calls[0][0]).split('?')[1]);expect(query.get('spool_id')).toBe('root');expect(query.has('task_ids')).toBe(false);expect(data.tasks[1].spool_id).toBe('child');
});
