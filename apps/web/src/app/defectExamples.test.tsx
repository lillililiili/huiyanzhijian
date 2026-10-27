import {act,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,test,vi} from 'vitest';
import {DefectExamples,DefectExampleViewer} from '../live/DefectExamples';
import {matchDefect,compareDecimal,ruleDirection} from '../live/defectMatch';
import {recordGraphic,exactDistance,DefectRecordGraphic} from '../live/DefectRecordGraphic';
import {TaskProcess,ProductionTasks} from '../live/ProductionPages';
import {ApiClient,emptyWorkspace,type Task,type Person,type Measurement} from '../live/api';
let root:Root|undefined,host:HTMLDivElement;
async function render(node:ReactNode){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(node));}
async function click(label:string){const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label);expect(button).toBeTruthy();await act(async()=>button!.click());}
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;host?.remove();vi.restoreAllMocks();});
const task={id:'t1',task_code:'202610270001',state:'ENDED',version:'1',metric_code:'SHIELD_OVERLAP_RATE',rule_snapshot:{approval_state:'TEST_ONLY',method_id:'test-dg',method_version:'1',comparison:{operator:'GE',lower:'10',upper:null}},context_snapshot:{specification:{id:'s',code:'test'}},measurements:{failed:2,total:8}} as Task;
const record={id:'r1',metric_code:task.metric_code,value:'9.9999999999',unit:'%',quality_result:'FAIL',receipt_status:'STORED',raw_payload:{task_id:'t1',sample_time:'2026-10-26T04:17:40.663Z',position_m:'0.7',data_status:'VALID',data_environment:'SIMULATED',device_id:'dev'}} as Measurement;
const page=(items:Measurement[],next:string|null=null)=>({items,has_more:!!next,next_cursor:next});
function metricCase(metric:string){const gap=metric==='WIRE_GAP';const t={...task,metric_code:metric,rule_snapshot:{...task.rule_snapshot,comparison:{operator:'LE',lower:null,upper:gap?'3':'8'}}};return {t,r:{...record,metric_code:metric,unit:gap?'mm':'%',value:gap?'3.0000000001':'8.0000000001'}};}
test('exact decimals and inclusive boundaries',()=>{
 expect(compareDecimal('9.9999999999','10')).toBe(-1);expect(compareDecimal('-0.0100','-0.01')).toBe(0);expect(compareDecimal('9007199254740993','9007199254740992')).toBe(1);
 expect(ruleDirection('10',task.rule_snapshot)).toBeNull();expect(ruleDirection(record.value,task.rule_snapshot)).toBe('LOW');expect(compareDecimal('NaN','10')).toBeNull();
 const range={...task.rule_snapshot,comparison:{operator:'BETWEEN',lower:'2',upper:'3'}};expect(ruleDirection('1.9999999999',range)).toBe('LOW');expect(ruleDirection('3.0000000001',range)).toBe('HIGH');expect(ruleDirection('3',range)).toBeNull();
});
test('three metrics match their own abnormal direction',()=>{
 expect(matchDefect(record,task).direction).toBe('LOW');for(const metric of ['WIRE_GAP','OVALITY']){const {t,r}=metricCase(metric);expect(matchDefect(r,t).direction).toBe('HIGH');}
});
test('invalid, quarantine, pass, missing rule, wrong task/metric/unit and opposite direction have no image',()=>{
 const records=[{...record,quality_result:'PASS'},{...record,receipt_status:'QUARANTINED'},{...record,raw_payload:{...record.raw_payload,data_status:'INVALID'}},{...record,raw_payload:{...record.raw_payload,task_id:'another'}},{...record,metric_code:'WIRE_GAP'},{...record,unit:'mm'},{...record,value:'10'}];for(const r of records)expect(matchDefect(r,task).direction).toBeUndefined();
 expect(matchDefect(record).direction).toBeUndefined();expect(matchDefect(record,{...task,rule_snapshot:{...task.rule_snapshot,comparison:null}}).direction).toBeUndefined();
 const {t,r}=metricCase('WIRE_GAP');expect(matchDefect({...r,value:'2'},{...t,rule_snapshot:{...t.rule_snapshot,comparison:{operator:'GE',lower:'3',upper:null}}}).reason).toContain('不使用相反方向');
});
test('missing, empty and normal summaries invent no images or requests',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request');await render(<DefectExamples api={api} context="task"/>);expect(host.textContent).toContain('摘要暂不可用');
 await act(async()=>root!.render(<DefectExamples api={api} context="task" failed={0} total={0}/>));expect(host.textContent).toContain('尚无采样');
 await act(async()=>root!.render(<DefectExamples api={api} context="task" failed={0} total={5}/>));expect(host.textContent).toContain('暂无超限');expect(host.querySelector('img')).toBeNull();expect(request).not.toHaveBeenCalled();
});
test('lazy real failure query, exact facts, record switching, zoom and focus restoration',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValue(page([record,{...record,id:'r2',value:'9.5',raw_payload:{...record.raw_payload,position_m:'0.3'}}]));
 await render(<DefectExamples api={api} task={task} context="任务 T1" failed={2} compact/>);expect(request).not.toHaveBeenCalled();const trigger=host.querySelector('button')!;trigger.focus();await act(async()=>trigger.click());
 expect(request.mock.calls[0][0]).toContain('task_id=t1');expect(request.mock.calls[0][0]).toContain('quality=FAIL');expect(request.mock.calls[0][0]).toContain('receipt_status=STORED');
 const dialog=document.querySelector('[role=dialog]')!;expect(dialog.textContent).toContain('9.9999999999');expect(dialog.textContent).toContain('0.7 m');expect(dialog.textContent).toContain('12:17:40.663');expect(dialog.textContent).toContain('本条实值绘图');expect(dialog.querySelector('svg')!.getAttribute('aria-label')).toContain('搭盖率偏低');expect(dialog.querySelector('.record-graphic')!.getAttribute('data-record-id')).toBe('r1');
 await click('下一条异常');expect(dialog.querySelector('.record-graphic')!.getAttribute('data-value')).toBe('9.5');expect(dialog.textContent).toContain('低于下限 0.5 个百分点');expect(dialog.textContent).toContain('9.5');expect(dialog.textContent).toContain('0.3 m');await click('放大查看');expect(dialog.querySelector('.defect-stage-zoom')).toBeTruthy();
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.querySelector('[role=dialog]')).toBeNull();expect(document.activeElement).toBe(trigger);
});
test('cursor crosses record25 to26; failed next page preserves old record',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValueOnce(page(Array.from({length:25},(_,i)=>({...record,id:'r'+i})),'opaque+cursor')).mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(page([{...record,id:'r26',value:'9.26'}]));
 await render(<DefectExampleViewer api={api} task={task} context="T1" onClose={()=>{}}/>);for(let i=0;i<24;i++)await click('下一条异常');await click('下一条异常');expect(document.body.textContent).toContain('offline');expect(document.body.textContent).toContain('记录ID：r24');await click('下一条异常');expect(document.body.textContent).toContain('9.26');expect(document.body.textContent).toContain('第 26 条');expect(request.mock.calls[2][0]).toContain('cursor=opaque%2Bcursor');
});
test('empty/error replies show no fabricated image and allow retry',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockRejectedValueOnce(Error('接口失败')).mockResolvedValueOnce(page([]));await render(<DefectExampleViewer api={api} task={task} context="T1" onClose={()=>{}}/>);expect(document.body.textContent).toContain('查询失败');expect(document.querySelector('img')).toBeNull();await click('重新查询');expect(document.body.textContent).toContain('没有有效');expect(document.querySelector('img')).toBeNull();
});
test('history keeps the selected record and never loads a generic photograph',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request');const {t,r}=metricCase('WIRE_GAP');await render(<DefectExampleViewer api={api} task={t} record={r} context="历史记录" onClose={()=>{}}/>);expect(request).not.toHaveBeenCalled();expect(document.querySelector('img')).toBeNull();expect(document.querySelector('svg')!.getAttribute('aria-label')).toContain('铜丝间隙偏大');expect(document.body.textContent).toContain('0.0000000001 mm');
});
test('switch task cancels old request and ignores late old metric reply',async()=>{
 const api=new ApiClient();let resolveOld:(v:unknown)=>void=()=>{};const {t,r}=metricCase('OVALITY');const request=vi.spyOn(api,'request').mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce(page([{...r,raw_payload:{...r.raw_payload,task_id:'t2'}}]));
 await render(<DefectExampleViewer api={api} task={task} context="T1" onClose={()=>{}}/>);await act(async()=>root!.render(<DefectExampleViewer api={api} task={{...t,id:'t2'}} context="T2" onClose={()=>{}}/>));expect(request.mock.calls[0][3]!.aborted).toBe(true);await act(async()=>resolveOld(page([record])));expect(document.querySelector('svg')!.getAttribute('aria-label')).toContain('不圆度偏大');expect(document.body.textContent).not.toContain('9.9999999999');
});
test('detail uses server summary, survives polling, and hides summary on error',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockImplementation(async path=>path.startsWith('/measurements')?page([record]):{measurements:{failed:2,total:8},transitions:[],plan:null,encounter:null});
 await render(<TaskProcess api={api} task={task}/>);await click(`查看异常图片：任务 ${task.task_code}`);await act(async()=>root!.render(<TaskProcess api={api} task={{...task,version:'2'}}/>));expect(document.querySelector('[role=dialog] svg')!.getAttribute('aria-label')).toContain('搭盖率偏低');await click('关闭图片预览');request.mockRejectedValue(Error('接口失败'));await act(async()=>root!.render(<TaskProcess api={api} task={{...task,version:'3'}}/>));expect(host.textContent).toContain('接口失败');expect(host.querySelector('img')).toBeNull();
});
test('task list exposes preview only for server failures',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({items:[task,{...task,id:'t2',task_code:'T2',measurements:{failed:0,total:8}}],total:2,running:0,ended:2,waiting:0,spools:1,page:1});await render(<ProductionTasks api={api} commands={{} as any} data={emptyWorkspace} user={{permissions:['data:read']} as Person} refresh={async()=>{}} params={new URLSearchParams()}/>);expect(host.querySelectorAll('.defect-preview-link')).toHaveLength(1);expect(host.querySelector('.defect-preview-link')!.getAttribute('aria-label')).toContain(task.task_code);
});

function observed(r:Measurement,observation:Record<string,string>,algorithm:string):Measurement{return {...r,raw_payload:{...r.raw_payload,raw:{data:{simulation_model:'SIM02',algorithm,observation}}} as Measurement['raw_payload']};}
test('exact differences preserve tiny deviations and signs',()=>{
 expect(exactDistance('9.9999999999','10')).toBe('0.0000000001');expect(exactDistance('0','10')).toBe('10');expect(exactDistance('10.000','110.000')).toBe('100');expect(exactDistance('-2.50','1.5')).toBe('4');
});
test('legacy scalar records have no invented dimensions or silhouettes',()=>{
 const model=recordGraphic(record,task);expect(model.delta).toBe('0.0000000001');expect(model.geometry).toBeUndefined();expect(model.geometryReason).toContain('未提供局部尺寸');
});
test('overlap visual uses exact observed widths and changes per record',async()=>{
 const a=observed({...record,value:'8'},{tape_width_mm:'20',overlap_width_mm:'1.6'},'sim-overlap-width-ratio.v1');const b=observed({...record,id:'r2',value:'5'},{tape_width_mm:'20',overlap_width_mm:'1'},'sim-overlap-width-ratio.v1');
 expect(recordGraphic(a,task).geometry).toEqual({kind:'overlap',width:'20',overlap:'1.6'});await render(<DefectRecordGraphic record={a} task={task}/>);const before=host.querySelector('svg')!.innerHTML;expect(host.textContent).toContain('搭盖宽 1.6 mm');await act(async()=>root!.render(<DefectRecordGraphic record={b} task={task}/>));expect(host.querySelector('svg')!.innerHTML).not.toBe(before);expect(host.textContent).toContain('搭盖宽 1 mm');expect(host.textContent).toContain('低于下限 5');
});
test('wire gap and ovality geometry reflect observations rather than a large stock defect',()=>{
 const wire=metricCase('WIRE_GAP');expect(recordGraphic(observed({...wire.r,value:'4.2'},{wire_gap_mm:'4.2'},'sim-wire-gap-direct.v1'),wire.t).geometry).toEqual({kind:'gap',gap:'4.2'});
 const oval=metricCase('OVALITY'),v=(200*4/76).toFixed(10);const t={...oval.t,rule_snapshot:{...oval.t.rule_snapshot,comparison:{operator:'LE',lower:null,upper:'8'}}};expect(recordGraphic(observed({...oval.r,value:v},{diameter_x_mm:'40',diameter_y_mm:'36'},'sim-legacy-percent-mean.v1'),t).geometry).toEqual({kind:'ovality',x:'40',y:'36'});
});
test('conflicting, incomplete or unknown method observation is not drawn',()=>{
 const r=observed({...record,value:'8'},{tape_width_mm:'20',overlap_width_mm:'1'},'sim-overlap-width-ratio.v1');expect(recordGraphic(r,task).geometry).toBeUndefined();expect(recordGraphic(r,task).geometryReason).toContain('冲突');
 for(const algorithm of ['unknown','sim-overlap-width-ratio.v1'])expect(recordGraphic(observed(record,{tape_width_mm:'0'},algorithm),task).geometry).toBeUndefined();
});
test('reverse-direction limit draws its actual comparison without a contrary stock image',()=>{
 const t={...task,rule_snapshot:{...task.rule_snapshot,comparison:{operator:'LE',lower:null,upper:'8'}}};const model=recordGraphic({...record,value:'9'},t);expect(model.name).toBe('搭盖率偏高');expect(model.delta).toBe('1');expect(model.direction).toBe('HIGH');
});
