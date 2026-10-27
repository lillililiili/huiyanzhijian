import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { resetViewState } from "../app/viewState";
import { DENY_WRITE } from "../auth/permissions";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { fmt } from "../ui/format";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { AlarmPage } from "./alarms/AlarmPage";
import { AlarmsPage } from "./alarms/AlarmsPage";
import { AnalyticsPage } from "./analytics/AnalyticsPage";
import { ReportPage } from "./reports/ReportPage";
import { ReportsPage } from "./reports/ReportsPage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const quality: SessionUser = { id: "U003", name: "质量审核员", username: "quality", role: "quality" };
const viewer: SessionUser = { id: "U004", name: "只读访客", username: "viewer", role: "viewer" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
  if (root) act(() => { root?.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(<>{node}<ToastViewport /></>); });
}

function freshStore(user: SessionUser = admin) {
  const source = createStore({ persistence: memoryPersistence() });
  source.setSession(user);
  return source;
}

function kpi(label: string) {
  const node = [...document.querySelectorAll(".kpi-label")].find(item => item.textContent === label);
  return node?.parentElement?.querySelector(".kpi-value")?.textContent || "";
}

function findButton(label: string) {
  return [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
}

async function clickButton(label: string) {
  await act(async () => {
    findButton(label)?.click();
  });
}

async function submitModal() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>("#active-modal-form button[type='submit']")?.click();
  });
}

function submitFilters() {
  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少筛选");
  act(() => {
    form.querySelector<HTMLButtonElement>("button[type='submit']")?.click();
  });
}

function captureDownloads() {
  const captured: { name: string; bytes: Promise<ArrayBuffer> }[] = [];
  let lastBlob: Blob | null = null;
  if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "";
  if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    if (value instanceof Blob) lastBlob = value;
    return "blob:mock";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (lastBlob && this.download) captured.push({ name: this.download, bytes: lastBlob.arrayBuffer() });
  });
  return captured;
}

function csvText(bytes: ArrayBuffer) {
  const raw = new Uint8Array(bytes);
  expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(raw);
}

function headings() {
  return [...document.querySelectorAll("h3")].map(node => node.textContent);
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetViewState();
  resetToasts();
  vi.restoreAllMocks();
  window.location.hash = "";
});

test("alarm list separates numeric state from disposition", () => {
  const source = freshStore();
  render(<AlarmsPage store={source} />);
  expect(document.querySelector("h1")?.textContent).toBe("报警事件");
  expect(kpi("过程超限事件")).toBe("2");
  expect(kpi("待人工复核")).toBe("1");
  expect(kpi("正在处理")).toBe("0");
  expect(kpi("已完成处置")).toBe("1");
  expect(document.body.textContent).toContain("共 2 条事件");
  expect(document.body.textContent).toContain("共 2 条记录");
  const rows = [...document.querySelectorAll("tbody tr")].map(row => row.textContent || "");
  expect(rows[0]).toContain("AL20261009002");
  expect(rows[0]).toContain("已恢复");
  expect(rows[0]).toContain("已处理");
  expect(rows[1]).toContain("AL20261009001");
  expect(rows[1]).toContain("待复核");
  expect(rows.join("")).not.toContain("仍超限");
  expect(document.body.textContent).not.toContain("待处理");
  expect(document.body.textContent).toContain("9.20");

  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少报警筛选");
  (form.querySelector("[name='keyword']") as HTMLInputElement).value = "p20261009001";
  (form.querySelector("[name='status']") as HTMLSelectElement).value = "pending";
  submitFilters();
  expect(document.body.textContent).toContain("共 1 条事件");
  expect(document.body.textContent).toContain("AL20261009001");
  expect(document.body.textContent).not.toContain("AL20261009002");
  act(() => { findButton("重置")?.click(); });
  expect(document.body.textContent).toContain("共 2 条事件");

  const open = source.alarm("AL20261009001");
  if (open) open.active = true;
  render(<AlarmsPage store={source} />);
  const pending = [...document.querySelectorAll("tbody tr")].find(row => row.textContent?.includes("AL20261009001"));
  expect(pending?.textContent).toContain("仍超限");
  expect(pending?.textContent).toContain("待复核");
  expect(pending?.textContent).not.toContain("已恢复");
});

test("alarm detail keeps the seed event and does not rewrite the measurement", async () => {
  const source = freshStore(quality);
  const alarm = source.alarm("AL20261009001");
  const record = alarm ? source.record(alarm.recordId) : undefined;
  if (!alarm || !record) throw new Error("缺少种子报警");
  const before = JSON.stringify(record);
  render(<AlarmPage store={source} user={quality} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("报警详情与处置");
  expect(document.body.textContent).toContain("AL20261009001");
  expect(document.body.textContent).toContain("数值已恢复");
  expect(document.body.textContent).toContain("待复核");
  expect(document.body.textContent).toContain("有效数据");
  expect(document.body.textContent).toContain("已确认");
  expect(document.body.textContent).toContain("检测中");
  expect(document.body.textContent).toContain("保留，不覆盖");
  expect(document.body.textContent).toContain("≥ 10 %");
  expect(document.body.textContent).toContain("V1.0");
  expect(document.body.textContent).toContain(`${fmt(record.meter, 1)} m`);
  expect(document.body.textContent).toContain("原始点：2026-10-09 14:06:00");
  expect(document.body.textContent).toContain("演示素材 · 非现场图像");
  expect(document.body.textContent).toContain("完成复核后再填写处置结论。当前数值恢复不会自动修改此事件的处理状态。");
  expect(document.body.textContent).not.toContain("待处理");
  expect(document.body.textContent).not.toContain("待同步");
  expect(document.body.textContent).not.toContain("无有效数据");
  expect(document.querySelector(".chart-host")?.getAttribute("style")).toContain("275px");
  expect(document.querySelector("a[href='#trace?reel=P20261009001']")).toBeTruthy();
  expect(document.querySelector("a[href='#task?id=T20261009001']")).toBeTruthy();
  expect(findButton("复核与处置")).toBeTruthy();

  await clickButton("复核与处置");
  const form = document.querySelector("#active-modal-form");
  if (!form) throw new Error("缺少复核窗口");
  const status = [...form.querySelectorAll("select[name='status'] option")].map(option => option.getAttribute("value"));
  expect(status).toEqual(["processing", "resolved"]);
  expect((form.querySelector("[name='status']") as HTMLSelectElement).value).toBe("processing");
  (form.querySelector("[name='status']") as HTMLSelectElement).value = "resolved";
  (form.querySelector("[name='note']") as HTMLTextAreaElement).value = "复核铜带张力后复测";
  await submitModal();
  expect(document.body.textContent).toContain("处置已保存，原始超限记录保留。");
  expect(source.alarm("AL20261009001")?.status).toBe("resolved");
  expect(source.alarm("AL20261009001")?.active).toBe(false);
  expect(source.alarm("AL20261009001")?.recoveredAt).toBe("2026-10-09 14:07:00");
  expect(source.record(alarm.recordId)).toBe(record);
  expect(JSON.stringify(record)).toBe(before);
  expect(record.value).toBe(9.2);
  expect(source.getState().audits.at(-1)?.action).toBe("报警复核");
  expect(source.getState().audits.at(-1)?.actor).toBe("质量审核员");
});

test("an active alarm cannot be closed and a viewer cannot open review", async () => {
  const source = freshStore();
  const alarm = source.alarm("AL20261009001");
  const record = alarm ? source.record(alarm.recordId) : undefined;
  if (!alarm || !record) throw new Error("缺少种子报警");
  alarm.active = true;
  const before = JSON.stringify(record);
  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=AL20261009001")} />);
  expect(document.body.textContent).toContain("数值仍超限");
  await clickButton("复核与处置");
  const form = document.querySelector("#active-modal-form");
  if (!form) throw new Error("缺少复核窗口");
  (form.querySelector("[name='status']") as HTMLSelectElement).value = "resolved";
  (form.querySelector("[name='note']") as HTMLTextAreaElement).value = "试图在超限未恢复时关闭";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toContain("当前超限尚未恢复，需恢复量测后再完成处置");
  expect(document.querySelector("#modal-title")?.textContent).toBe("报警复核与处置");
  expect(source.alarm("AL20261009001")?.status).toBe("pending");
  expect(source.alarm("AL20261009001")?.active).toBe(true);
  expect(JSON.stringify(record)).toBe(before);

  render(<AlarmPage store={source} user={viewer} params={new URLSearchParams("id=AL20261009002")} />);
  expect(findButton("补充处置记录")).toBeTruthy();
  expect(document.body.textContent).toContain("该事件已完成人工处理。原始超限值及后续补充记录继续保留。");
  await clickButton("补充处置记录");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(source.alarm("AL20261009002")?.status).toBe("resolved");
});

test("missing alarm ids and a missing measurement do not fall through to another event", () => {
  const source = freshStore();
  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=MISSING")} />);
  expect(document.querySelector("h1")?.textContent).toBe("暂无报警事件");
  expect(document.body.textContent).toContain("请从列表中选择对应记录。");
  expect(document.body.textContent).not.toContain("AL20261009001");
  expect(document.querySelector(".chart-host")).toBeNull();

  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=")} />);
  expect(document.querySelector("h1")?.textContent).toBe("暂无报警事件");
  expect(document.body.textContent).not.toContain("AL20261009001");

  const alarm = source.alarm("AL20261009001");
  if (alarm) alarm.recordId = "missing-record";
  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=AL20261009001")} />);
  expect(document.querySelector("h1")?.textContent).toBe("关联量测记录不存在");
  expect(document.body.textContent).not.toContain("原始超限值");
  expect(document.body.textContent).not.toContain("AL20261009002");

  const linked = source.recordsFor("T20261009001")[0];
  linked.validity = "invalid";
  linked.mesStatus = "pending";
  const restored = source.alarm("AL20261009002");
  if (restored) restored.recordId = linked.id;
  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=AL20261009002")} />);
  expect(document.body.textContent).toContain("无效数据");
  expect(document.body.textContent).toContain("待同步");
  expect(document.body.textContent).not.toContain("无有效数据");
  expect(document.body.textContent).not.toContain("待处理");
});

test("analytics summarizes valid rows and lets a viewer export the filtered set", async () => {
  const source = freshStore(viewer);
  const audits = source.getState().audits.length;
  const downloads = captureDownloads();
  render(<AnalyticsPage store={source} />);
  expect(document.querySelector("h1")?.textContent).toBe("质量统计分析");
  expect(kpi("有效量测记录")).toBe("198");
  expect(kpi("过程超限记录")).toBe("2");
  expect(kpi("覆盖盘号")).toBe("12");
  expect(kpi("记录符合阈值比例")).toBe(`${fmt(196 / 198 * 100)}%`);
  expect(document.body.textContent).toContain("无效 / 缺失 0 条，不参与阈值统计");
  expect(document.querySelectorAll(".chart-host")).toHaveLength(3);
  expect(document.querySelector(".chart-host")?.getAttribute("style")).toContain("205px");
  const reelRows = [...document.querySelectorAll("tbody tr")].map(row => row.textContent || "");
  expect(reelRows).toHaveLength(8);
  expect(reelRows[0]).toContain("P20261009001");
  expect(reelRows[0]).toContain("搭盖率");
  expect(reelRows[0]).toContain("30 / 30");
  expect(reelRows.some(row => row.includes("P20261009009"))).toBe(false);
  expect(document.body.textContent).toContain("共 12 条记录");
  await clickButton("导出统计明细");
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toBe("慧眼智检-质量统计明细.csv");
  expect(csvText(await downloads[0].bytes).split("\r\n").length - 1).toBe(198);
  expect(source.getState().audits.length).toBe(audits);
  expect(document.querySelector(".toast")).toBeNull();

  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少统计筛选");
  (form.querySelector("[name='metric']") as HTMLSelectElement).value = "dg";
  (form.querySelector("[name='from']") as HTMLInputElement).value = "2026-10-10";
  (form.querySelector("[name='to']") as HTMLInputElement).value = "2026-10-01";
  submitFilters();
  expect(document.body.textContent).toContain("开始日期晚于结束日期，请调整查询范围。");
  expect(kpi("有效量测记录")).toBe("0");
  expect(kpi("记录符合阈值比例")).toBe("—");
  expect(document.body.textContent).toContain("共 0 条记录");
  expect(document.querySelectorAll(".chart-host")).toHaveLength(1);
  await clickButton("导出统计明细");
  expect(downloads[1].name).toBe("慧眼智检-质量统计明细.csv");
  expect(csvText(await downloads[1].bytes).split("\r\n").length - 1).toBe(0);
});

test("reports list opens the latest snapshot and blocks a viewer", async () => {
  const source = freshStore(viewer);
  render(<ReportsPage store={source} user={viewer} />);
  expect(document.querySelector("h1")?.textContent).toBe("质量报告管理");
  expect(kpi("报告总数")).toBe("9");
  expect(kpi("阶段报告")).toBe("0");
  expect(kpi("最终报告")).toBe("9");
  expect(document.body.textContent).toContain("9 份报告");
  expect(document.body.textContent).toContain("共 9 条记录");
  expect(document.querySelector("tbody tr")?.textContent).toContain("RP20261009009");
  expect(findButton("生成质量报告")).toBeTruthy();
  await clickButton("生成质量报告");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(source.getState().reports).toHaveLength(9);

  source.getState().tasks.splice(0, source.getState().tasks.length);
  render(<ReportsPage store={source} user={quality} />);
  await clickButton("生成质量报告");
  expect(document.body.textContent).toContain("请先创建检测任务。");
  expect(document.querySelector("#modal-title")).toBeNull();
});

test("a running task makes a stage report and an open alarm blocks the final report", async () => {
  const source = freshStore(quality);
  render(<ReportsPage store={source} user={quality} />);
  await clickButton("生成质量报告");
  const option = document.querySelector<HTMLOptionElement>("#active-modal-form option[value='T20261009001']");
  expect(option?.textContent).toContain("未结束 / 阶段报告");
  await submitModal();
  const created = source.getState().reports.at(-1);
  if (!created) throw new Error("未生成报告");
  expect(created.kind).toBe("stage");
  expect(created.taskId).toBe("T20261009001");
  expect(created.snapshot.records).toHaveLength(30);
  expect(created.snapshot.alarms).toHaveLength(1);
  expect(window.location.hash).toBe(`#report?id=${encodeURIComponent(created.id)}`);
  expect(document.body.textContent).toContain("报告快照已生成。");

  const downloads = captureDownloads();
  render(<ReportPage store={source} params={new URLSearchParams({ id: created.id })} />);
  expect(document.body.textContent).toContain("阶段数据记录 · 任务未结束，最终质量结论尚未生成");
  expect(document.body.textContent).toContain("原始超限值");
  expect(document.body.textContent).toContain("9.20");
  expect(document.body.textContent).not.toContain("本报告无关联报警记录");
  expect(document.querySelector(".chart-host")?.getAttribute("style")).toContain("265px");
  await clickButton("导出报告数据");
  expect(downloads[0].name).toBe(`${created.id}-报告快照.csv`);
  const exported = csvText(await downloads[0].bytes);
  const lines = exported.split("\r\n");
  expect(lines.length - 1).toBe(created.snapshot.records.length);
  const header = lines[0].split(",");
  const versionAt = header.indexOf("\"规则版本\"");
  const failed = lines.find(line => line.includes("\"9.2\""));
  expect(failed?.split(",")[versionAt]).toBe("\"V1.0\"");

  act(() => { resetToasts(); });
  const blocked = freshStore();
  act(() => { blocked.completeTask("T20261009001"); });
  render(<ReportsPage store={blocked} user={admin} />);
  await clickButton("生成质量报告");
  expect(document.querySelector("#active-modal-form option[value='T20261009001']")?.textContent).toContain("已完成 / 最终报告");
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toContain("请先完成关联报警的复核处置，再生成最终报告");
  expect(document.querySelector("#modal-title")?.textContent).toBe("生成质量报告");
  expect(blocked.getState().reports).toHaveLength(9);
  expect(document.body.textContent).not.toContain("报告快照已生成。");
});

test("report preview reads the snapshot and prints without a second shell", async () => {
  const source = freshStore(viewer);
  const downloads = captureDownloads();
  if (typeof window.print !== "function") window.print = () => {};
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<ReportPage store={source} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("报告预览与导出");
  expect(document.querySelector(".report-document")?.textContent).toContain("RP20261009009");
  expect(document.body.textContent).toContain("高压电缆质量检测报告");
  expect(document.body.textContent).toContain("220 kV · 1×1200 mm²");
  expect(document.body.textContent).toContain("有效检测记录符合所配置阈值 · 最终放行由质量人员确认");
  expect(document.body.textContent).toContain("本报告无关联报警记录。");
  expect(document.body.textContent).toContain("本报告为原型演示数据，不作为产品出厂证明。");
  expect(document.body.textContent).toContain("质量管理员");
  expect(document.body.textContent).not.toContain("调整查询条件");
  expect(document.querySelector(".report-document img")?.getAttribute("src")).toBe("assets/images/logo.png");
  expect(headings()).toEqual(["检测数据汇总", "量测趋势", "过程异常与复核快照", "量测明细"]);
  expect(document.querySelectorAll(".chart-host")).toHaveLength(1);
  const value = document.querySelector<HTMLElement>(".report-document .kpi-value");
  expect(value?.getAttribute("style")).toContain("font-size: 22px");
  expect(value?.getAttribute("style")).toContain("overflow-wrap: anywhere");
  await clickButton("导出报告数据");
  expect(downloads[0].name).toBe("RP20261009009-报告快照.csv");
  expect(csvText(await downloads[0].bytes).split("\r\n").length - 1).toBe(12);
  expect(source.getState().audits.some(entry => entry.action.includes("导出"))).toBe(false);
  await clickButton("打印 / 保存 PDF");
  expect(print).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".toast")).toBeNull();

  const spec = source.getState().specs.find(item => item.id === "SP220-1200");
  if (!spec) throw new Error("缺少规格");
  spec.area = 9999;
  source.getState().reportTemplate.title = "已改标题";
  source.getState().reportTemplate.includeTrend = false;
  act(() => { source.log("测试刷新", "确认报告快照不跟随现场数据"); });
  expect(document.querySelector(".report-document")?.textContent).toContain("220 kV · 1×1200 mm²");
  expect(document.querySelector(".report-document")?.textContent).toContain("高压电缆质量检测报告");
  expect(document.body.textContent).not.toContain("9999");
  expect(document.body.textContent).not.toContain("已改标题");
  expect(document.querySelectorAll(".chart-host")).toHaveLength(1);

  const hidden = freshStore();
  const last = hidden.getState().reports.at(-1);
  if (!last) throw new Error("缺少报告");
  last.snapshot.template = { ...last.snapshot.template, includeLogo: false, includeTrend: false, includeDetails: false };
  render(<ReportPage store={hidden} params={new URLSearchParams()} />);
  expect(document.querySelector(".report-document img")).toBeNull();
  expect(document.querySelector(".chart-host")).toBeNull();
  expect(headings()).not.toContain("量测趋势");
  expect(headings()).not.toContain("量测明细");
  expect(document.body.textContent).toContain("全部量测明细可通过“导出报告数据”下载；导出依据此报告快照。");

  const flagged = freshStore();
  const finalReport = flagged.getState().reports[0];
  finalReport.snapshot.alarms = [{
    id: "AL-OPEN",
    recordId: "none",
    taskId: finalReport.taskId,
    metric: finalReport.snapshot.task.metric,
    active: false,
    status: "pending",
    createdAt: "2026-10-09 10:00:00",
    recoveredAt: null,
    note: "",
    history: []
  }];
  render(<ReportPage store={flagged} params={new URLSearchParams({ id: finalReport.id })} />);
  expect(document.body.textContent).toContain("检测已完成 · 存在待复核事件，待质量确认");
  expect(document.body.textContent).toContain("暂无人工复核结论");
  expect(document.body.textContent).not.toContain("本报告无关联报警记录");

  const failed = freshStore();
  const failedReport = failed.getState().reports[0];
  failedReport.snapshot.records[0].judgement = "fail";
  render(<ReportPage store={failed} params={new URLSearchParams({ id: failedReport.id })} />);
  expect(document.body.textContent).toContain("检测已完成 · 过程存在超限记录，请依据复核结论确认质量");

  render(<ReportPage store={source} params={new URLSearchParams("id=MISSING")} />);
  expect(document.querySelector("h1")?.textContent).toBe("尚无质量报告");
  expect(document.querySelector(".report-document")).toBeNull();
  expect(document.body.textContent).not.toContain("RP20261009009");
  render(<ReportPage store={source} params={new URLSearchParams("id=")} />);
  expect(document.querySelector("h1")?.textContent).toBe("尚无质量报告");
  expect(document.body.textContent).not.toContain("RP20261009001");
});
