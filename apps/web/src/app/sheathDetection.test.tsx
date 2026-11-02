import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,test,vi} from 'vitest';
import {SheathDetection} from '../live/SheathDetection';
import {LivePages} from '../live/LivePages';
import {ApiClient,emptyWorkspace,type Measurement,type Task} from '../live/api';
import {sheathAvailable,sheathChartRows} from '../live/sheathDisplay';
import {breadcrumbTitle} from './hashRoute';
import {navGroups} from './nav';
import {downloadFile} from '../ui/download';
const chart=vi.hoisted(()=>({setOption:vi.fn(),on:vi.fn(),off:vi.fn(),dispose:vi.fn(),resize:vi.fn(),dispatchAction:vi.fn()}));
vi.mock('echarts',()=>({init:()=>chart}));
vi.mock('../ui/download',async original=>({...await original<typeof import('../ui/download')>(),downloadFile:vi.fn()}));
let root:Root,host:HTMLDivElement;
async function render(node:ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(node));}
async function click(text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(b).toBeTruthy();await act(async()=>b.click());}
async function select(label:string,value:string){const el=host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;await act(async()=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));});}
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.clearAllMocks();vi.useRealTimers();});
const task={id:'t1',task_code:'T1',state:'ENDED',metric_code:'OVALITY',device_id:'D1',context_snapshot:{spool_code:'盘1',external_code:'工单1',specification:{code:'SP',voltage_kv:'35',conductor_area_mm2:'300',core_count:1}},rule_snapshot:{comparison:{operator:'LE',upper:'8'}},data_environment:'SIMULATED'} as Task;
function row(i:number,status='VERIFIED',value='2.0000000000'):Measurement{return {id:String(i),ingest_order:String(i),value:'99',unit:'%',metric_code:'OVALITY',quality_result:'FAIL',evaluation_reason:null,receipt_status:'STORED',eligibility:'TEST_ONLY',position_eligibility:'UNVERIFIED',received_at:'2026-11-02T03:00:00.123456Z',raw_payload:{task_id:'t1',sample_time:new Date(Date.UTC(2026,10,2,3,0,i)).toISOString(),device_id:'D1',record_id:String(i),capture_sequence:String(i),position_m:null,position_quality:'UNKNOWN',data_status:'VALID',data_environment:'SIMULATED',recipe_version_id:null,values:[]},sheath_result:{status,value:status==='VERIFIED'?value:null,unit:'mm',method:'sheath-v3',validation_version:'SC01.v1',reason:status==='VERIFIED'?'中心核对通过':'配对缺失',pair:{aMean:'40',bMean:'38',aId:'A1',bId:'B1',delayMs:350,syncRevision:1}}};}
function fixture(api:ApiClient,items:Measurement[]){return vi.spyOn(api,'request').mockImplementation(async path=>{const p=new URL('http://test'+path).searchParams,offset=Number(p.get('cursor')||0),all=[...items].reverse();return {items:all.slice(offset,offset+100),total:all.length,has_more:offset+100<all.length,next_cursor:offset+100<all.length?String(offset+100):null,as_of:'2026-11-02T04:00:00Z'};});}
test('sheath projection uses only verified stored values and retains zero/negative without borrowing ovality FAIL',()=>{
 const rows=[row(1,'VERIFIED','0'),row(2,'VERIFIED','-0.0000000001'),row(3,'INVALID'),row(4,'UNAVAILABLE'),row(5,'NOT_PROVIDED'),{...row(6),receipt_status:'QUARANTINED'},{...row(7),raw_payload:{...row(7).raw_payload,data_status:'INVALID'}},row(8,'VERIFIED','NaN')];
 expect(rows.filter(sheathAvailable)).toHaveLength(2);expect(sheathChartRows(rows).map(r=>r.value)).toEqual(['0','-0.0000000001',null,null,null,null,null,null]);expect(sheathChartRows(rows).every(r=>r.quality_result==='NOT_EVALUATED')).toBe(true);expect(rows[0].value).toBe('99');
});
test('complete pages feed thickness chart; table filter/pagination/export and detail keep original identity',async()=>{
 const api=new ApiClient(),rows=Array.from({length:126},(_,i)=>row(i+1,i<2?'NOT_PROVIDED':'VERIFIED'));fixture(api,rows);
 await render(<SheathDetection api={api} task={task}/>);
 expect(chart.setOption.mock.calls.at(-1)![0].series[0].data).toHaveLength(126);expect(chart.setOption.mock.calls.at(-1)![0].series[0].markLine.data).toHaveLength(0);
 expect(host.textContent).toContain('有效配对 124 条');expect(host.textContent).toContain('第 1 / 6 页');expect(host.textContent).not.toContain('超限点');
 await click('下一页');expect(host.textContent).toContain('第 2 / 6 页');await click('不可用记录2');expect(host.textContent).toContain('共 2 条');expect(host.querySelector('table')!.textContent).not.toContain('99');
 await click('导出筛选记录 CSV');expect(String(vi.mocked(downloadFile).mock.calls[0][1])).toContain('配对缺失');await click('详情');expect(document.body.textContent).toContain('护套厚度记录详情');expect(document.body.textContent).toContain('sheath-v3');
 expect(chart.setOption.mock.calls.at(-1)![0].series[0].data).toHaveLength(126);
});
test('live increments retain old rows, pause/resume and failures do not become an empty success',async()=>{
 vi.useFakeTimers();const api=new ApiClient();let rows=[row(1)],fail=false;
 vi.spyOn(api,'request').mockImplementation(async()=>{if(fail)throw Error('时序不可用');return {items:[...rows].reverse(),total:rows.length,has_more:false,next_cursor:null};});
 await render(<SheathDetection api={api} task={{...task,state:'RUNNING'}}/>);
 rows=[row(1),row(2)];await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(host.textContent).toContain('完整任务趋势 · 2条');await click('暂停自动刷新');rows.push(row(3));await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(host.textContent).toContain('完整任务趋势 · 2条');
 await click('继续自动刷新');fail=true;await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(host.textContent).toContain('保留上次完整快照');expect(host.textContent).toContain('完整任务趋势 · 2条');fail=false;await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(host.textContent).toContain('完整任务趋势 · 3条');
});
test('empty and request failure remain distinct',async()=>{
 const api=new ApiClient();const request=fixture(api,[]);await render(<SheathDetection api={api} task={task}/>);expect(host.textContent).toContain('当前筛选范围没有记录');request.mockRejectedValue(Error('权限不足'));await click('刷新');expect(host.textContent).toContain('护套记录读取失败：权限不足');expect(host.textContent).not.toContain('当前筛选范围没有记录');
});

test('shared record toolbar keeps pairing semantics, reasons and page controls aligned',async()=>{
 const api=new ApiClient(),missing=row(30);delete missing.sheath_result;
 const rows=[...Array.from({length:27},(_,i)=>row(i+1)),row(28,'INVALID'),row(29,'UNAVAILABLE'),missing];fixture(api,rows);
 await render(<SheathDetection api={api} task={task}/>);
 const panel=host.querySelector('.detection-record-panel')!;
 const group=panel.querySelector('[aria-label="护套配对状态筛选"]')!;
 expect(group.closest('.panel-head')).toBeTruthy();expect(group.querySelector('[aria-pressed="true"]')!.textContent).toBe('全部记录');
 expect(panel.querySelector('.measurement-pagination select[aria-label="每页显示条数"]')).toBeTruthy();
 await click('下一页');expect(panel.textContent).toContain('第 2 / 2 页');
 await click('不可用记录3');expect(panel.textContent).toContain('第 1 / 1 页 · 共 3 条');expect(group.querySelector('[aria-pressed="true"]')!.textContent).toContain('不可用记录');
 await select('护套配对筛选','NOT_PROVIDED');expect(panel.textContent).toContain('共 1 条');expect(panel.querySelector('table')!.textContent).toContain('未携带配对');
 await select('护套配对筛选','INVALID');expect(panel.querySelector('table')!.textContent).toContain('配对校验失败');
 await click('有效配对');expect(panel.textContent).toContain('共 27 条');expect(panel.querySelector('select[aria-label="护套配对筛选"]')).toBeNull();
 expect(panel.textContent).not.toContain('仅超限项');expect(panel.textContent).toContain('非质量判定');
 await select('每页显示条数','50');expect(panel.textContent).toContain('第 1 / 1 页 · 共 27 条');
 await click('刷新查询');expect(group.querySelector('[aria-pressed="true"]')!.textContent).toBe('有效配对');expect(panel.textContent).toContain('共 27 条');
 await click('全部记录');expect(panel.textContent).toContain('共 30 条');expect(chart.setOption.mock.calls.at(-1)![0].series[0].data).toHaveLength(30);
});
test('fourth navigation and route select OVALITY tasks but stay on sheath view',async()=>{
 expect(navGroups[0].items.at(-1)).toEqual(['detection?metric=ht','护套厚度检测']);expect(breadcrumbTitle('detection',new URLSearchParams('metric=ht'))).toBe('护套厚度检测');
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue({items:[task],total:1,spools:1,page:1,running:0,waiting:0,ended:1});
 await render(<LivePages route="detection" params={new URLSearchParams('metric=ht')} api={api} commands={{} as any} data={emptyWorkspace} user={{permissions:[]} as any} refresh={async()=>{}}/>);
 expect(request.mock.calls[0][0]).toContain('metric_code=OVALITY');expect(host.textContent).toContain('护套厚度 · 选择任务');expect(host.querySelector('a[href^="#detection?metric=ht&task=t1"]')).toBeTruthy();expect(host.querySelector('a[href="#detection?metric=ht"]')).toBeTruthy();
});
test('sheath task route renders mm and rejects other instrument tasks',async()=>{
 const api=new ApiClient();fixture(api,[row(1)]);const props={route:'detection',params:new URLSearchParams('metric=ht&task=t1'),api,commands:{} as any,data:{...emptyWorkspace,tasks:[task]},user:{permissions:[]} as any,refresh:async()=>{}};
 await render(<LivePages {...props}/>);expect(host.querySelector('h1')!.textContent).toBe('护套厚度检测');expect(host.textContent).toContain('最近有效厚度');expect(host.querySelector('a[href="#detection?metric=ht"]')).toBeTruthy();
 await act(async()=>root.render(<LivePages {...props} data={{...emptyWorkspace,tasks:[{...task,metric_code:'WIRE_GAP'}]}}/>));expect(host.textContent).toContain('指标与任务不匹配');
});
