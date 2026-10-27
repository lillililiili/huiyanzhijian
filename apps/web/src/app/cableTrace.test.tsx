import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,test,vi} from 'vitest';
import {CableTrace,type SpoolSummary} from '../live/CableTrace';
import {Measurements} from '../live/Measurements';
import {ApiClient,Commands,emptyWorkspace,type Measurement,type Task} from '../live/api';
import {downloadFile} from '../ui/download';
vi.mock('../ui/download',async original=>({...await original<typeof import('../ui/download')>(),downloadFile:vi.fn()}));
let root:Root,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
async function click(name:string){const b=[...container.querySelectorAll('button')].find(b=>b.textContent===name)!;expect(b).toBeTruthy();await act(async()=>b.click());}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();vi.clearAllMocks();});
const user={id:'viewer',username:'viewer',name:'viewer',factory_id:'factory',permissions:['data:read']};
const task=(id:string,metric='SHIELD_OVERLAP_RATE')=>({id,task_code:id,spool_id:'member',process_id:'p',metric_code:metric,device_id:'d',data_environment:'SIMULATED',state:'ENDED',planned_length_m:'100',reported_length_m:'100',rule_snapshot:{approval_state:'UNAPPROVED',comparison:null,method_id:null,method_version:null},context_snapshot:{spool_code:'创建盘号'}} as Task);
const summary:SpoolSummary={root_id:'main',requested_id:'member',scope_hash:'hash',as_of:'2026-10-26T00:00:00Z',members:[{id:'main',spool_code:'主盘',version:'1',work_order_id:'wo',external_code:'WO',specification_id:'spec',created_at:''},{id:'member',canonical_spool_id:'main',spool_code:'改名盘',version:'2',work_order_id:'wo',external_code:'WO',specification_id:'spec',created_at:''}],tasks:[task('first'),task('repeat'),task('second','OVALITY')],measurements:[{task_id:'first',total:8,valid:6,invalid:2,passed:4,failed:2,unevaluated:2,quarantined:0,minimum:'9.9999999999',maximum:'12.5000000001',mean:'10.1',unit:'%',first_sample_at:null,latest_sample_at:null}]};
test('cable summary retains repeated tasks and current/original identities, never adds physical lengths',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue(summary);
 await render(<CableTrace api={api} data={emptyWorkspace} commands={new Commands(api)} refresh={async()=>{}} user={user} id="member"/>);
 expect(container.textContent).toContain('任务：3');expect(container.textContent).toContain('样本：8');expect(container.textContent).toContain('无效/缺测 2');expect(container.textContent).toContain('创建时：创建盘号');expect(container.textContent).toContain('当前：改名盘');
 expect(container.textContent).toContain('尚未选择复检采用结果');expect(container.textContent).not.toContain('300');expect(container.textContent).not.toContain('修改盘号 / 同盘归并');
 const link=container.querySelector('a[href*="task?id=repeat"]')!;expect(link.getAttribute('href')).toContain('back=trace%3Fspool%3Dmember');
 expect(container.querySelector('a[href="#history?spool=member"]')).not.toBeNull();
});
test('empty cable has zero tasks and samples, and no fabricated numeric extrema',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({...summary,tasks:[],measurements:[]});
 await render(<CableTrace api={api} data={emptyWorkspace} commands={new Commands(api)} refresh={async()=>{}} user={user} id="main"/>);
 expect(container.textContent).toContain('任务：0');expect(container.textContent).toContain('样本：0');expect(container.textContent).toContain('未形成结论');expect(container.textContent).not.toContain('9.9999999999');
});
const row=(id:string)=>({id,value:'8.0000000001',unit:'%',metric_code:'OVALITY',quality_result:'FAIL',receipt_status:'STORED',raw_payload:{task_id:'t',device_id:'d',sample_time:'2026-10-26T00:00:00Z',data_status:'VALID',data_environment:'SIMULATED'}} as Measurement);
test('history sends server spool scope even before workspace loads, preserving validity/process filters',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[],has_more:false,next_cursor:null});
 await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams('spool=main&data_status=INVALID&receipt_status=STORED&process_id=p')}/>);
 const q=new URLSearchParams(String(request.mock.calls[0][0]).split('?')[1]);expect(q.get('spool_id')).toBe('main');expect(q.get('data_status')).toBe('INVALID');expect(q.get('receipt_status')).toBe('STORED');expect(q.get('process_id')).toBe('p');expect(q.has('task_ids')).toBe(false);
});
test('scope conflict aborts complete export without producing a partial file',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockImplementation(async path=>{if(path.includes('cursor='))throw new Error('查询范围已变化');return {items:[row('one')],has_more:true,next_cursor:'old-scope',as_of:'cutoff'};});
 await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams('spool=main')}/>);await click('导出原始JSON');
 expect(downloadFile).not.toHaveBeenCalled();expect(container.textContent).toContain('查询范围已变化');expect([...container.querySelectorAll('button')].find(b=>b.textContent==='导出原始JSON')!.disabled).toBe(true);
});
test('switching cable clears drawer and ignores a delayed old next-page result',async()=>{
 let resolveNext:(v:unknown)=>void=()=>{};const api=new ApiClient();vi.spyOn(api,'request').mockImplementation(async path=>path.includes('cursor=')?new Promise(r=>{resolveNext=r;}):{items:[row(path.includes('spool_id=second')?'second-record':'first-record')],has_more:true,next_cursor:'cursor'});
 await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams('spool=first')}/>);await click('详情');expect(document.body.textContent).toContain('记录ID：first-record');
 await click('下一页');await act(async()=>root.render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams('spool=second')}/>));
 await act(async()=>resolveNext({items:[row('stale-record')],has_more:false,next_cursor:null}));expect(document.body.textContent).not.toContain('记录ID：first-record');expect(container.textContent).not.toContain('stale-record');expect(container.textContent).toContain('第1页');
});
