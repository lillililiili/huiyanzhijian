import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {WorkOrders} from '../live/WorkOrders';
import {ProductionTasks} from '../live/ProductionPages';
import {ActivityStatus} from '../live/ActivityStatus';
import {DeviceCatalog,MetricDefinitions} from '../live/OperationsPages';
import {SpoolForm,TaskForm} from '../live/TaskForms';
import {Measurements} from '../live/Measurements';
import {ApiClient,Commands,emptyWorkspace,type Person} from '../live/api';
vi.mock('echarts',()=>({init:()=>({setOption:vi.fn(),on:vi.fn(),resize:vi.fn(),dispose:vi.fn()})}));
let root:Root,container:HTMLDivElement;
async function render(n:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(n));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();});
const user:Person={id:'u',name:'u',username:'u',factory_id:'f',permissions:['data:read','task:write']};
function props(query=''){const api=new ApiClient();return {api,commands:new Commands(api),data:emptyWorkspace,user,refresh:async()=>{},params:new URLSearchParams(query)};}
test('work order list is server paged, searchable and preserves return filters',async()=>{
 const p=props('q=订单&page=2'),spy=vi.spyOn(p.api,'request').mockResolvedValue({total:23,page:2,limit:20,items:[{id:'order',external_code:'订单23',state:'NO_TASK',registered_spools:0,physical_spools:0,task_count:0}]});
 await render(<WorkOrders {...p}/>);expect(spy.mock.calls[0][0]).toContain('page=2');expect(container.textContent).toContain('筛选内23单');
 const link=[...container.querySelectorAll('a')].find(a=>a.textContent==='工单详情')!;expect(decodeURIComponent(link.hash)).toContain('back=workorders?q=');expect(container.textContent).toContain('未分配任务');
});
test('order tasks retain the order scope on reset and hide duplicate creation controls',async()=>{
 const p=props('id=order&tab=tasks&back=workorders'),spy=vi.spyOn(p.api,'request').mockImplementation(async path=>path.startsWith('/work-order')?{external_code:'订单',task_count:1,state:'WAITING'}:{items:[],total:0,page:1});
 await render(<WorkOrders {...p}/>);const query=String(spy.mock.calls.find(([p])=>p.startsWith('/production/tasks'))![0]);
 expect(query).toContain('work_order_id=order');expect(query).not.toContain('back=');expect(container.textContent).not.toContain('新建工单');
 const reset=[...container.querySelectorAll('a')].find(a=>a.textContent==='重置')!;expect(reset.hash).toContain('work_order_id=order');expect(reset.hash).toContain('tab=tasks');
});
test('detection task selector delegates management to task center',async()=>{
 const p=props();vi.spyOn(p.api,'request').mockResolvedValue({items:[],total:0,page:1});await render(<ProductionTasks {...p} metric="OVALITY"/>);
 expect(container.textContent).toContain('任务管理');for(const s of ['新建工单','登记线缆','批量计划','自动发现配置'])expect(container.textContent).not.toContain(s);
});
test('task communication and invalid late sample do not overwrite running state',async()=>{
 await render(<ActivityStatus activity={{as_of:'',observation_seconds:30,task_state:'RUNNING',communication:'OFFLINE',last_heartbeat_at:null,sampling:'DELAYED_DATA',received_age_seconds:1,sample_age_seconds:60,latest:{record_id:'r',received_at:'2026-10-26T00:00:00.123456Z',sample_time:'',value:null,unit:'%',data_status:'INVALID',receipt_status:'STORED',quality_result:'NOT_EVALUATED'}}}/>);
 expect(container.textContent).toContain('通信离线');expect(container.textContent).toContain('收到迟到数据');expect(container.textContent).toContain('无效');expect(container.textContent).toContain('.123456');expect(container.textContent).not.toContain('已结束');
});
test('device and metric pages have separate responsibilities',async()=>{
 await render(<><DeviceCatalog data={emptyWorkspace}/><MetricDefinitions data={emptyWorkspace}/></>);expect(container.textContent).toContain('设备基础资料');expect(container.textContent).toContain('指标与适用关系');expect(container.textContent).not.toContain('当前线缆 / 任务');
});
test('reused spool and task forms preselect the current order',async()=>{
 const p=props(),data={...emptyWorkspace,orders:[{id:'order',external_code:'订单',specification_id:'spec',created_at:''}]};
 await render(<SpoolForm {...p} data={data} initialOrder="order" close={()=>{}}/>);expect(document.querySelector<HTMLSelectElement>('select[name=order]')?.value).toBe('order');
 await act(async()=>root.render(<TaskForm {...p} data={data} initialOrder="order" close={()=>{}}/>));expect([...document.querySelectorAll('select')].some(s=>s.value==='order')).toBe(true);
});
test('ended task is a manual history view with no auto-follow or duplicate export',async()=>{
 const p=props();const interval=vi.spyOn(window,'setInterval');
 vi.spyOn(p.api,'request').mockImplementation(async path=>path.startsWith('/task-activity/')?{task_state:'ENDED',communication:'OFFLINE',sampling:'NO_DATA',observation_seconds:30}:{items:[],has_more:false});
 await render(<Measurements api={p.api} data={p.data} task={{id:'ended',version:'1',state:'ENDED',rule_snapshot:{comparison:null},data_environment:'SIMULATED'} as any} params={p.params} live/>);
 expect(container.textContent).toContain('检测记录回看');expect(container.textContent).toContain('刷新查询');expect(container.textContent).not.toContain('继续自动刷新');expect(container.textContent).not.toContain('导出完整筛选CSV');expect(interval).not.toHaveBeenCalled();
});
test('order detail API failure does not offer record-changing actions',async()=>{
 const p=props('id=missing');vi.spyOn(p.api,'request').mockRejectedValue(new Error('工单不存在'));await render(<WorkOrders {...p}/>);
 expect(container.textContent).toContain('工单不存在');expect(container.textContent).not.toContain('登记线缆');expect(container.textContent).not.toContain('分配检测任务');
});
