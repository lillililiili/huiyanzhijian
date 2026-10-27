import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {ServerList} from '../live/ServerLists';
import {TaskSamples} from '../live/TaskSamples';
import {LiveApp} from '../live/LiveApp';
import {ApiClient,emptyWorkspace,type SampleSummary} from '../live/api';
let root:Root,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();vi.unstubAllGlobals();window.location.hash='';});
const spool={id:'s',spool_code:'当前盘B',external_code:'工单B',specification_id:'spec',state:'PARTIAL',environments:['SIMULATED'],metrics:['SHIELD_OVERLAP_RATE'],identity_count:2,task_count:3,waiting_count:1,running_count:0,ended_count:2,cancelled_count:0,created_at:'2026-10-26T00:00:00Z'};
test('cable list uses server filters, whole totals and preserves page filters in drilldown and navigation',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[spool],total:502,page:2,limit:20,tasks:900,running_tasks:0,as_of:'time'});
 await render(<ServerList kind="spools" api={api} data={emptyWorkspace} params={new URLSearchParams('q=盘&state=PARTIAL&page=2')}/>);
 expect(String(request.mock.calls[0][0])).toContain('/production/spools?');expect(String(request.mock.calls[0][0])).toContain('page=2');expect(container.textContent).toContain('502 盘线缆');expect(container.textContent).toContain('关联任务 900');
 expect(container.querySelector('a[href*="spool=s"]')!.getAttribute('href')).toContain('back=trace');
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='下一页')!.click());const q=new URLSearchParams(window.location.hash.split('?')[1]);expect(q.get('page')).toBe('3');expect(q.get('state')).toBe('PARTIAL');expect(q.get('q')).toBe('盘');
});
test('query submission resets page; plan search never uses legacy truncated endpoint',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[],total:0,page:4,limit:20,as_of:'time'});
 await render(<ServerList kind="plans" api={api} data={emptyWorkspace} params={new URLSearchParams('view=plans&page=4&state=DRAFT')}/>);
 const path=String(request.mock.calls[0][0]);expect(path).toContain('/production/plans?');expect(path).not.toContain('view=');
 const q=container.querySelector<HTMLInputElement>('input[name="q"]')!;q.value='新条件';await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 const result=new URLSearchParams(window.location.hash.split('?')[1]);expect(result.has('page')).toBe(false);expect(result.get('view')).toBe('plans');expect(result.get('q')).toBe('新条件');
});
test('late old filter response is ignored and failed query cannot show old rows',async()=>{
 let resolveOld:(x:any)=>void=()=>{};const api=new ApiClient();vi.spyOn(api,'request').mockImplementation(async path=>path.includes('q=old')?new Promise(r=>{resolveOld=r;}):Promise.reject(new Error('筛选不可用')));
 await render(<ServerList kind="spools" api={api} data={emptyWorkspace} params={new URLSearchParams('q=old')}/>);
 await act(async()=>root.render(<ServerList kind="spools" api={api} data={emptyWorkspace} params={new URLSearchParams('q=new')}/>));
 await act(async()=>resolveOld({items:[spool],total:1,page:1,limit:20}));expect(container.textContent).toContain('筛选不可用');expect(container.textContent).not.toContain('当前盘B');
});
test('out-of-range page keeps server total and offers first page without showing fake data',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({items:[],total:21,page:3,limit:20,as_of:'time'});
 await render(<ServerList kind="spools" api={api} data={emptyWorkspace} params={new URLSearchParams('page=3')}/>);
 expect(container.textContent).toContain('21 盘线缆');expect(container.textContent).toContain('当前页已无数据');expect([...container.querySelectorAll('button')].find(b=>b.textContent==='下一页')!.disabled).toBe(true);
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='第一页')!.click());expect(window.location.hash).not.toContain('page=');
});
test('sample summary preserves decimals and separates no samples from missing summary',async()=>{
 const summary={total:8,valid:6,invalid:2,failed:2,unevaluated:2,quarantined:0,latest_sample_at:'2026-10-26T00:00:00.123456Z',minimum:'9.9999999999',maximum:'12.5000000001',mean:'10.123456789123',unit:'%'} as SampleSummary;
 await render(<TaskSamples summary={summary}/>);expect(container.textContent).toContain('样本 8');expect(container.textContent).toContain('无效/缺测 2');expect(container.textContent).toContain('10.123456789123');expect(container.textContent).toContain('.123456 北京时间');
 await act(async()=>root.render(<TaskSamples/>));expect(container.textContent).toContain('暂不可用');expect(container.textContent).not.toContain('样本 0');
});
test('opening a list does not fetch all tasks, spools or work orders; form preparation does so on demand',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 window.location.hash='#tasks';const all=vi.spyOn(ApiClient.prototype,'all').mockResolvedValue([]);
 vi.spyOn(ApiClient.prototype,'request').mockImplementation(async path=>path==='/auth/me'?{user:{id:'u',username:'admin',name:'test',factory_id:'f',permissions:['data:read','task:write']},csrf_token:'token'}:path==='/catalog'?emptyWorkspace.catalog:path==='/device-status'?[]:{items:[],total:0,page:1,spools:0,running:0,ended:0,waiting:0});
 await render(<LiveApp/>);expect(all).not.toHaveBeenCalled();
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='登记线缆')!.click());expect(all.mock.calls.map(x=>x[0])).toEqual(['/tasks','/spools','/work-orders']);expect(document.body.textContent).toContain('登记多盘线缆');
});
