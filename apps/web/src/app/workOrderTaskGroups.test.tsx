import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {ProductionTasks} from '../live/ProductionPages';
import {groupWorkOrderTasks,groupSampleCounts,loadWorkOrderTasks} from '../live/groupedTaskData';
import {ApiClient,Commands,emptyWorkspace,type Task} from '../live/api';

let root:Root|undefined,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root!.render(node));}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;container?.remove();vi.restoreAllMocks();});
function task(id:string):Task{return {id,task_code:'任务-'+id,work_order_id:'wo',spool_id:'cable',canonical_spool_id:'cable',current_spool_code:'线缆A',process_id:'by',metric_code:'OVALITY',device_id:'HY-BY-01',state:'ENDED',data_environment:'SIMULATED',created_at:'2026-11-02T01:00:00Z',context_snapshot:{specification:{},spool_code:'线缆A'},measurements:{total:10,failed:2,invalid:1,unevaluated:3,valid:9,passed:5}} as Task;}
function make(id:string,extra:Partial<Task>={}){return {...task(id),...extra};}
function result(items:Task[]){return {items,total:items.length,spools:1,ended:items.filter(t=>t.state==='ENDED').length,running:items.filter(t=>t.state==='RUNNING').length,waiting:0,page:1};}
function props(items:Task[],query=''){
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue(result(items));
 return {api,commands:new Commands(api),data:{...emptyWorkspace,catalog:{...emptyWorkspace.catalog,inspection_process:[{id:'by',name:'挤塑工序'}]}},user:{id:'viewer',name:'viewer',username:'viewer',factory_id:'f',permissions:['data:read']},refresh:async()=>{},params:new URLSearchParams('id=wo&tab=tasks&work_order_id=wo&'+query),embedded:true,context:{route:'workorders',params:{id:'wo',tab:'tasks',work_order_id:'wo'}}};
}
test('stable physical cable and process merge attempts, not names or other processes/orders',()=>{
 const items=[make('a'),make('b',{spool_id:'alias'}),make('c',{canonical_spool_id:'different'}),make('d',{process_id:'dg'}),make('e',{work_order_id:'other'})];
 const groups=groupWorkOrderTasks(items);expect(groups.map(g=>g.tasks.map(t=>t.id))).toEqual([['a','b'],['c'],['d'],['e']]);expect(items[1].spool_id).toBe('alias');
});
test('unknown identities stay separate',()=>{expect(groupWorkOrderTasks([make('a',{process_id:''}),make('b',{process_id:''})])).toHaveLength(2);});
test('count summaries retain past failures and invalids, missing summary is not zero',()=>{
 expect(groupSampleCounts([make('a'),make('b',{measurements:{...task('b').measurements!,failed:0}})])).toEqual({total:20,failed:2,invalid:2,unevaluated:6});
 expect(groupSampleCounts([make('a'),make('b',{measurements:undefined})])).toBeNull();
});
test('loads all scoped API pages before grouping, preserves filters, ignores display page',async()=>{
 const api=new ApiClient(),items=Array.from({length:101},(_,i)=>make(String(i))),read=vi.spyOn(api,'request').mockImplementation(async path=>({...result(items),items:new URLSearchParams(path.split('?')[1]).get('page')==='1'?items.slice(0,100):items.slice(100)}));
 const loaded=await loadWorkOrderTasks(api,'work_order_id=wo&state=ENDED&page=7',new AbortController().signal);
 expect(loaded.items).toHaveLength(101);expect(groupWorkOrderTasks(loaded.items)).toHaveLength(1);expect(read).toHaveBeenCalledTimes(2);
 for(const [path] of read.mock.calls){expect(path).toContain('work_order_id=wo');expect(path).toContain('state=ENDED');expect(path).toContain('limit=100');}
});
test.each(['changed','duplicate','empty'])('rejects %s pagination instead of displaying partial group totals',async mode=>{
 const api=new ApiClient(),read=vi.spyOn(api,'request');read.mockResolvedValueOnce({...result([make('a')]),total:2});read.mockResolvedValueOnce({...result(mode==='empty'?[]:[make(mode==='duplicate'?'a':'b')]),total:mode==='changed'?3:2});
 await expect(loadWorkOrderTasks(api,'work_order_id=wo',new AbortController().signal)).rejects.toThrow('变化');
});
test('missing scope cannot trigger an unscoped bulk read',async()=>{const api=new ApiClient(),read=vi.spyOn(api,'request');await expect(loadWorkOrderTasks(api,'',new AbortController().signal)).rejects.toThrow('工单范围');expect(read).not.toHaveBeenCalled();});
test('group collapsed by default; expansion exposes exact task links, devices and independent counts',async()=>{
 const p=props([make('third',{device_id:'HY-BY-02',state:'RUNNING'}),make('first')]);await render(<ProductionTasks {...p}/>);
 expect(container.textContent).toContain('1 组 · 2 个任务');expect(container.textContent).toContain('20 条结果');expect(container.textContent).toContain('2 台设备');expect(container.textContent).not.toContain('任务-third');
 const button=container.querySelector<HTMLButtonElement>('.wg-toggle')!;await act(async()=>button.click());
 expect(button.getAttribute('aria-expanded')).toBe('true');expect(container.textContent).toContain('任务-third');expect(container.textContent).toContain('任务-first');expect(container.textContent).toContain('HY-BY-02');
 const links=[...container.querySelectorAll('a')];expect(links.some(l=>l.hash.includes('task=third')&&l.textContent==='进入检测')).toBe(true);expect(links.some(l=>l.hash.includes('task=first')&&l.textContent==='回看检测')).toBe(true);expect(links.find(l=>l.hash.includes('task=third'))!.hash).toContain('back=workorders');
 expect(container.textContent).not.toContain('新建检测任务');await act(async()=>button.click());expect(container.textContent).not.toContain('任务-third');
});
test('groups paginate as units and a later API task stays with its group',async()=>{
 const items=[...Array.from({length:21},(_,i)=>make(String(i),{canonical_spool_id:'c'+i,spool_id:'c'+i})),make('again',{canonical_spool_id:'c0',spool_id:'c0'})];
 const p=props(items,'page=2');await render(<ProductionTasks {...p}/>);expect(container.querySelectorAll('.wg-toggle')).toHaveLength(1);expect(container.textContent).toContain('第 2 页 / 2 页');
 await act(async()=>root!.render(<ProductionTasks {...p} params={new URLSearchParams('work_order_id=wo&page=1')}/>));expect(container.querySelectorAll('.wg-toggle')).toHaveLength(20);expect(container.querySelector('.wg-toggle')?.textContent).toContain('展开 2 个任务');
});
test('empty and incomplete results are explicit, no passing quality invented',async()=>{
 const p=props([]);await render(<ProductionTasks {...p}/>);expect(container.textContent).toContain('未找到符合条件的任务');
 const p2=props([make('missing',{measurements:undefined})]);await act(async()=>root!.render(<ProductionTasks {...p2}/>));expect(container.textContent).toContain('摘要不完整');expect(container.textContent).not.toContain('0 个样本');
});
test.each(['权限不足','网络请求未完成'])('read error %s is visible and can be retried',async message=>{
 const p=props([]);vi.mocked(p.api.request).mockRejectedValue(new Error(message));await render(<ProductionTasks {...p}/>);expect(container.querySelector('[role=alert]')?.textContent).toBe(message);expect(container.querySelector('.wg-table')).toBeNull();
 vi.mocked(p.api.request).mockResolvedValue(result([make('retry')]));await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='刷新任务')!.click());expect(container.textContent).toContain('1 组 · 1 个任务');
});
