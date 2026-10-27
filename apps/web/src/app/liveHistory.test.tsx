import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { Measurements } from "../live/Measurements";
import { ApiClient, emptyWorkspace, type Measurement } from "../live/api";
import { downloadFile } from "../ui/download";
const chartMocks=vi.hoisted(()=>({setOption:vi.fn(),on:vi.fn(),off:vi.fn(),dispatchAction:vi.fn(),resize:vi.fn(),dispose:vi.fn()}));
vi.mock("echarts",()=>({init:()=>chartMocks,format:{encodeHTML:(value:string)=>value}}));
vi.mock("../live/ActivityStatus",()=>({TaskActivityPanel:()=>null}));
vi.mock("../live/DefectExamples",()=>({DefectExamples:({failed}:{failed?:number})=>failed? <button type="button">查看异常图片：{failed}条超限</button>:null,DefectExampleViewer:()=> <div role="dialog">异常记录图片预览</div>}));
vi.mock("../ui/download", async importOriginal => ({...await importOriginal<typeof import("../ui/download")>(), downloadFile: vi.fn()}));
let root: Root; let container: HTMLDivElement;
async function render(node: ReactNode){container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
async function click(name:string){const button=[...container.querySelectorAll("button")].find(b=>b.textContent===name)!;expect(button).toBeTruthy();await act(async()=>button.click());}
afterEach(async () => { if(root)await act(async()=>root.unmount()); container?.remove(); vi.clearAllMocks(); });
const row = (id: string, position="1.0"): Measurement => ({id,ingest_order:id,value:"8.0000000001",unit:"%",metric_code:"OVALITY",quality_result:"FAIL",evaluation_reason:null,receipt_status:"STORED",eligibility:"TEST_ONLY",position_eligibility:"UNVERIFIED",received_at:"2026-10-26T00:00:00.123456Z",raw_payload:{task_id:"task",device_id:"HY-BY-01",record_id:id,sample_time:"2026-10-26T00:00:00.123456Z",position_m:position,position_quality:"UNKNOWN",data_status:"VALID",data_environment:"SIMULATED",capture_sequence:id,recipe_version_id:null,values:[]}});
test("history paging shows filtered totals and exports all frozen pages without losing decimals", async () => {
  const api = new ApiClient();
  const request = vi.spyOn(api,"request").mockImplementation(async path => path.includes("cursor=") ? {items:[row("1")],total:26,has_more:false,next_cursor:null,as_of:"cutoff"} : {items:[row("2")],total:26,has_more:true,next_cursor:"signed-cursor",as_of:"cutoff"});
  await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams("quality=FAIL")}/>);
  expect(container.textContent).toContain("第1页 · 1条");
  expect(container.textContent).toContain("第 1 / 2 页 · 共 26 条");
  await click("下一页");
  expect(container.textContent).toContain("第2页 · 1条");
  expect(container.textContent).toContain("第 2 / 2 页 · 共 26 条");
  await click("导出原始JSON");
  expect(downloadFile).toHaveBeenCalledOnce();
  const payload=JSON.parse(String(vi.mocked(downloadFile).mock.calls[0][1]));
  expect(payload.records.map((r:Measurement)=>r.id)).toEqual(["2","1"]);
  expect(payload.records[0].value).toBe("8.0000000001");
  expect(payload.records[0].raw_payload.sample_time).toBe("2026-10-26T00:00:00.123456Z");
  expect(payload.filters.quality).toBe("FAIL");
  expect(request.mock.calls.slice(1).every(([path])=>path.includes("cursor=signed-cursor"))).toBe(true);
});
test("history page size can be changed and restarts the query from its first page", async () => {
  const api=new ApiClient(),request=vi.spyOn(api,"request").mockResolvedValue({items:[row("2")],total:26,has_more:true,next_cursor:"signed-cursor",as_of:"cutoff"});
  await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams("quality=FAIL")}/>);
  const select=container.querySelector<HTMLSelectElement>('select[aria-label="每页显示条数"]')!;
  await act(async()=>{select.value="50";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(request.mock.calls.some(([path])=>path.includes("limit=50"))).toBe(true);
  expect(container.textContent).toContain("第 1 / 1 页 · 共 26 条");
});
test("ended task chart loads every cursor page while detection rows remain paginated", async () => {
  const api=new ApiClient();
  const ascending=Array.from({length:200},(_,i)=>row(String(i+1),(i*.5).toFixed(1)));
  const descending=[...ascending].reverse();
  const request=vi.spyOn(api,"request").mockImplementation(async path=>{
    if(path.includes("cursor=chart-cursor"))return {items:descending.slice(100),total:200,has_more:false,next_cursor:null,as_of:"cutoff"};
    if(path.includes("limit=100"))return {items:descending.slice(0,100),total:200,has_more:true,next_cursor:"chart-cursor",as_of:"cutoff"};
    if(path.includes("cursor=table-cursor"))return {items:descending.slice(25,50),total:200,has_more:true,next_cursor:"table-cursor-2",as_of:"cutoff"};
    return {items:descending.slice(0,25),total:200,has_more:true,next_cursor:"table-cursor",as_of:"cutoff"};
  });
  const task={id:"task",task_code:"T-1",state:"ENDED",metric_code:"OVALITY",device_id:"HY-BY-01",spool_id:"spool",context_snapshot:{spool_code:"线缆1号"},rule_snapshot:{comparison:null},data_environment:"SIMULATED"} as any;
  await render(<Measurements api={api} data={emptyWorkspace} task={task} params={new URLSearchParams()} live/>);
  await act(async()=>{await Promise.resolve();});
  await click("米数轴");
  const option=chartMocks.setOption.mock.calls.at(-1)?.[0];
  expect(option.xAxis.data).toHaveLength(200);
  expect(option.xAxis.data[0]).toBe("0.0");
  expect(option.xAxis.data.at(-1)).toBe("99.5");
  expect(container.textContent).toContain("第 1 / 8 页 · 共 200 条");
  expect(request.mock.calls.some(([path])=>path.includes("limit=25")&&path.includes("task_id=task"))).toBe(true);
  expect(request.mock.calls.some(([path])=>path.includes("cursor=chart-cursor"))).toBe(true);
  expect(option.dataZoom.some((z:any)=>z.type==='slider')).toBe(true);
  expect(option.series[0].areaStyle).toBeTruthy();
  await click('恢复全局');
  expect(chartMocks.dispatchAction).toHaveBeenCalledWith({type:'dataZoom',start:0,end:100});
});
test("ended task summary uses complete records and focuses the latest server failure", async()=>{
  const api=new ApiClient();
  const samples=[
    {...row("old","10"),value:"2.4",quality_result:"PASS",raw_payload:{...row("old").raw_payload,sample_time:"2026-10-26T00:00:00Z"}},
    {...row("pending","11"),value:"8.8",quality_result:"NOT_EVALUATED",raw_payload:{...row("pending").raw_payload,sample_time:"2026-10-26T00:00:01Z"}},
    {...row("failure","12"),value:"7.6",quality_result:"FAIL",raw_payload:{...row("failure","12").raw_payload,sample_time:"2026-10-26T00:00:02Z"}},
  ] as Measurement[];
  const request=vi.spyOn(api,"request").mockImplementation(async path=>path.includes("limit=100")?{items:samples,total:3,has_more:false,next_cursor:null,as_of:"cutoff"}:path.includes("cursor=")?{items:[samples[1]],total:30,has_more:false,next_cursor:null,as_of:"cutoff"}:{items:[samples[0]],total:30,has_more:true,next_cursor:"table-cursor",as_of:"cutoff"});
  const task={id:"task",task_code:"202610270001",state:"ENDED",metric_code:"OVALITY",device_id:"HY-BY-01",spool_id:"spool",context_snapshot:{spool_code:"线缆1号"},rule_snapshot:{comparison:null},data_environment:"SIMULATED"} as any;
  await render(<Measurements api={api} data={emptyWorkspace} task={task} params={new URLSearchParams()} live/>);
  await act(async()=>{await Promise.resolve();});
  const cards=container.querySelectorAll(".review-kpi");
  expect(cards).toHaveLength(4);
  expect(cards[1].querySelector('strong')?.textContent).toBe('30');
  expect(container.querySelector('.review-sampling-line')?.textContent).toContain('有效 3');
  expect(container.querySelector('.review-result-pass strong')?.textContent).toBe('1 条');
  expect(container.querySelector('.review-result-fail strong')?.textContent).toBe('1 条');
  expect(container.querySelector('.review-result-not_evaluated strong')?.textContent).toBe('1 条');
  expect(container.querySelector('.review-latest-failure')?.textContent).toContain('7.6 %');
  expect(container.querySelector('.review-latest-failure')?.textContent).toContain('12 m（未验证）');
  await click("下一页");
  expect(container.textContent).toContain("第 2 / 2 页");
  expect(cards[1].querySelector('strong')?.textContent).toBe('30');
  expect(container.querySelector('.review-result-fail strong')?.textContent).toBe('1 条');
  await act(async()=>container.querySelector<HTMLButtonElement>('.review-failure-record')!.click());
  expect(document.body.textContent).toContain("原始测量记录");
  expect(document.body.textContent).toContain("来源米数：12（未验证）");
  expect(request.mock.calls.some(([path])=>path.includes("limit=100")&&path.includes("task_id=task"))).toBe(true);
});
test("pending records remain separate and an unjudged high value is not shown as a failure",async()=>{
  const api=new ApiClient();
  const pending={...row("pending","22"),value:"8.8",quality_result:"NOT_EVALUATED"} as Measurement;
  const pass={...row("pass","20"),value:"2.4",quality_result:"PASS"} as Measurement;
  vi.spyOn(api,"request").mockImplementation(async path=>path.includes("limit=100")?{items:[pending,pass],total:2,has_more:false,next_cursor:null,as_of:"cutoff"}:{items:[pending],total:2,has_more:true,next_cursor:"table-cursor",as_of:"cutoff"});
  const task={id:"task",task_code:"202610270001",state:"ENDED",metric_code:"OVALITY",device_id:"HY-BY-01",spool_id:"spool",context_snapshot:{spool_code:"线缆1号"},rule_snapshot:{comparison:null},data_environment:"SIMULATED"} as any;
  await render(<Measurements api={api} data={emptyWorkspace} task={task} params={new URLSearchParams()} live/>);
  await act(async()=>{await Promise.resolve();});
  expect(container.querySelector('.review-result-not_evaluated strong')?.textContent).toBe('1 条');
  expect(container.querySelector('.review-result-fail strong')?.textContent).toBe('0 条');
  expect(container.querySelector('.review-latest-failure')?.textContent).toContain('暂无有效已存储的超限记录');
  expect(container.querySelector('.review-range')?.textContent).toContain('8.8 %');
  expect(container.querySelector('.review-latest-failure button')).toBeNull();
});
test("running task card shows the server total and labels page breakdown",async()=>{
  const api=new ApiClient();
  vi.spyOn(api,"request").mockResolvedValue({items:[row("live")],total:40,has_more:true,next_cursor:"table-cursor",as_of:"cutoff"});
  const task={id:"task",task_code:"202610270001",state:"RUNNING",metric_code:"OVALITY",device_id:"HY-BY-01",spool_id:"spool",context_snapshot:{spool_code:"线缆1号"},rule_snapshot:{comparison:null},data_environment:"SIMULATED"} as any;
  await render(<Measurements api={api} data={emptyWorkspace} task={task} params={new URLSearchParams()} live/>);
  const cards=container.querySelectorAll(".review-kpi");
  expect(cards[1].textContent).toContain('接收记录总数');
  expect(cards[1].querySelector('strong')?.textContent).toBe('40');
  expect(cards[2].textContent).toContain('当前页');
  expect(container.querySelector('.review-sampling-line')?.textContent).toContain('有效 1');
  await click('查看超限记录与图片');
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('异常记录图片预览');
});
test("an empty spool never falls through to all measurement records", async () => {
  const api=new ApiClient(),request=vi.spyOn(api,"request").mockRejectedValue(new Error("线缆不存在或无权访问"));
  await render(<Measurements api={api} data={emptyWorkspace} params={new URLSearchParams("spool=empty")}/>);
  expect(container.textContent).toContain("线缆不存在或无权访问");
  expect(request).toHaveBeenCalledOnce();expect(String(request.mock.calls[0][0])).toContain("spool_id=empty");
});

test("history display and CSV keep query-time association when the workspace has newer ownership", async () => {
 const api=new ApiClient();const record={...row('3'),business_context:{task_id:'task',task_code:'202610260003',spool_id:'a',spool_code:'查询时盘A',work_order_id:'wa',external_code:'工单A',original_spool_id:'origin',original_work_order_id:'wo',original_spool_code:'创建盘',association_version:'2'}};
 vi.spyOn(api,'request').mockResolvedValue({items:[record],has_more:false,next_cursor:null,as_of:'cutoff'});
 const data={...emptyWorkspace,tasks:[{id:'task',spool_id:'b',task_code:'202610260003',context_snapshot:{spool_code:'创建盘'}}],spools:[{id:'b',spool_code:'后改盘B',work_order_id:'wb'}]} as any;
 await render(<Measurements api={api} data={data} params={new URLSearchParams()}/>);
 expect(container.textContent).toContain('查询时盘A');await click('导出完整筛选CSV');
 const csv=String(vi.mocked(downloadFile).mock.calls[0][1]);expect(csv).toContain('查询时盘A');expect(csv).toContain('创建盘');expect(csv).not.toContain('后改盘B');
});
