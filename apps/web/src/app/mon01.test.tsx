import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,test,vi} from 'vitest';
import {collectionState,observedActivity} from '../live/collectionState';
import {OperationsPage} from '../live/OperationsPages';
import {TaskExecutionStatus} from '../live/ActivityStatus';
import {useRunningActivities} from '../live/useActivityRead';
import {emptyWorkspace,type ApiClient,type TaskActivity,type Workspace,type Task} from '../live/api';

const activity=(extra:Partial<TaskActivity>={}):TaskActivity=>({as_of:new Date().toISOString(),observation_seconds:30,task_state:'RUNNING',communication:'ONLINE',last_heartbeat_at:null,sampling:'RECENT_DATA',received_age_seconds:1,sample_age_seconds:2,latest:{record_id:'r',received_at:'2026-11-03T01:00:00.123456Z',sample_time:'2026-11-03T01:00:00Z',value:'9',unit:'%',data_status:'VALID',receipt_status:'STORED',quality_result:'FAIL'},...extra});
const cases:[string,Partial<TaskActivity>,string][]=[
 ['近期有效',{sampling:'RECENT_DATA'},'采集中'],
 ['等待首条',{sampling:'NO_DATA',latest:null},'等待首条数据'],
 ['在线无新数据',{sampling:'NO_RECENT_DATA'},'暂无新数据'],
 ['离线无新数据',{communication:'OFFLINE',sampling:'NO_RECENT_DATA'},'暂无新数据'],
 ['离线仍收到数据',{communication:'OFFLINE'},'收到数据 · 通信离线'],
 ['未知心跳有接收',{communication:'UNKNOWN'},'正在接收数据'],
 ['补传',{sampling:'DELAYED_DATA'},'接收补传数据'],
 ['异常时钟',{sampling:'CLOCK_UNVERIFIED'},'采样时钟待核对'],
 ['缺测',{latest:{...activity().latest!,value:null,data_status:'MISSING'}},'采样缺测'],
 ['无效',{latest:{...activity().latest!,data_status:'INVALID'}},'采样异常'],
 ['隔离',{latest:{...activity().latest!,receipt_status:'QUARANTINED'}},'采样已隔离'],
 ['有效零值',{latest:{...activity().latest!,value:'0'}},'采集中'],
 ['空值不冒充有效采集',{latest:{...activity().latest!,value:null}},'采样异常'],
 ['已变更终态',{task_state:'ENDED'},'已结束'],
 ];
test.each(cases)('%s按实际采样显示',(_name,change,label)=>expect(collectionState('RUNNING',activity(change)).label).toBe(label));
test('生命周期及读取失败不假定正在采集',()=>{
 expect(collectionState('RUNNING',undefined).label).toBe('采集状态待查询');
 expect(collectionState('RUNNING',activity(),'503').label).toBe('采集状态待确认');
 expect(collectionState('ENDED',activity(),'503').label).toBe('已结束');
 expect(collectionState('CANCELLED',activity()).label).toBe('已取消');
 expect(collectionState('CREATED',activity()).label).toBe('待开始');
});
test('30秒观察边界及迟到/坏时钟不会误报实时，保留原记录',()=>{
 const a=activity({received_age_seconds:0});
 expect(observedActivity(a,30)?.sampling).toBe('RECENT_DATA');
 expect(observedActivity(a,31)?.sampling).toBe('NO_RECENT_DATA');
 expect(observedActivity(activity({sampling:'DELAYED_DATA'}),31)?.sampling).toBe('NO_RECENT_DATA');
 expect(observedActivity(activity({sampling:'CLOCK_UNVERIFIED'}),60)?.sampling).toBe('CLOCK_UNVERIFIED');
 expect(a.sampling).toBe('RECENT_DATA');expect(a.latest?.quality_result).toBe('FAIL');
});
let root:Root|undefined,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=undefined;host?.remove();vi.useRealTimers();});
async function render(node:React.ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(node));}
test('无新服务器响应时徽标也会过期，恢复数据后更新',async()=>{
 vi.useFakeTimers();const a=activity({received_age_seconds:0});
 await render(<TaskExecutionStatus state="RUNNING" activity={a}/>);
 expect(host.textContent).toContain('采集中');
 await act(async()=>vi.advanceTimersByTime(35000));expect(host.textContent).toContain('暂无新数据');
 await act(async()=>root!.render(<TaskExecutionStatus state="RUNNING" activity={activity()}/>));
 expect(host.textContent).toContain('采集中');
});
test('监控两台同指标设备独立变化，查询失败保留历史但不假报采集，恢复后更新',async()=>{
 vi.useFakeTimers();const tasks=['one','two'].map((id)=>({id,task_code:id,state:'RUNNING',metric_code:'OVALITY',device_id:id,current_spool_code:id,context_snapshot:{},activity:activity()} as Task));
 const data={...emptyWorkspace,catalog:{...emptyWorkspace.catalog,production_line:[{id:'line',name:'隔离工位'}],device:tasks.map(t=>({id:t.id,name:t.id,line_id:'line',metric_code:'OVALITY',data_environment:'SIMULATED'}))}} as Workspace;
 let payload={as_of:new Date().toISOString(),connections:[],tasks:[{...tasks[0],id:'paired-child',metric_code:'SHEATH_THICKNESS',activity:activity({sampling:'NO_DATA',latest:null})},...tasks]},fail=false;
 const request=vi.fn(async()=>{if(fail)throw Error('服务暂不可用');return payload;});const api={request} as unknown as ApiClient;
 await render(<OperationsPage api={api} data={data}/>);
 expect(host.querySelectorAll('.collection-status .badge')).toHaveLength(2);
 expect(Array.from(host.querySelectorAll('.collection-status .badge')).map(x=>x.textContent)).toEqual(['采集中','采集中']);
 payload={...payload,tasks:[{...tasks[0],activity:activity({sampling:'NO_RECENT_DATA',communication:'OFFLINE'})},tasks[1]]};
 await act(async()=>vi.advanceTimersByTimeAsync(5000));
 let badges=Array.from(host.querySelectorAll('.collection-status .badge')).map(x=>x.textContent);
 expect(badges).toEqual(['暂无新数据','采集中']);
 fail=true;await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(host.textContent).toContain('服务暂不可用');expect(host.textContent).toContain('末次记录');
 expect(host.querySelectorAll('.collection-status .badge')[1].textContent).toBe('采集状态待确认');
 fail=false;payload={...payload,tasks:tasks.map(t=>({...t,activity:activity()}))};await act(async()=>vi.advanceTimersByTimeAsync(5000));
 badges=Array.from(host.querySelectorAll('.collection-status .badge')).map(x=>x.textContent);expect(badges).toEqual(['采集中','采集中']);
 expect(host.textContent).toContain('超限');expect(tasks[0].state).toBe('RUNNING');
});
test('列表仅批量刷新运行任务的状态，无运行任务停止读取；缺失任务不套用其他设备状态',async()=>{
 vi.useFakeTimers();const task={id:'one',state:'RUNNING',activity:activity()} as Task;
 let tasks=[task];const request=vi.fn(async(_path:string)=>({as_of:new Date().toISOString(),connections:[],tasks}));
 const api={request} as unknown as ApiClient;
 function List({items}:{items:Task[]}){const statusFor=useRunningActivities(api,items);return <>{items.map(t=><TaskExecutionStatus key={t.id} state={t.state} {...statusFor(t)}/>)}</>;}
 await render(<List items={[task]}/>);expect(host.textContent).toContain('采集中');
 tasks=[{...task,id:'other-device-task'}];await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(host.textContent).toContain('采集状态待确认');expect(request.mock.calls.every(c=>c[0]==='/operations/overview')).toBe(true);
 const count=request.mock.calls.length;await act(async()=>root!.render(<List items={[{...task,state:'ENDED'}]}/>));
 await act(async()=>vi.advanceTimersByTimeAsync(20000));expect(request).toHaveBeenCalledTimes(count);expect(host.textContent).toContain('已结束');
});

