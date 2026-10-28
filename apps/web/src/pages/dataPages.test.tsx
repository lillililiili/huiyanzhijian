import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { getViewSnapshot, resetViewState } from "../app/viewState";
import { DENY_WRITE_CORE } from "../auth/permissions";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { HistoryPage } from "./history/HistoryPage";
import { TracePage } from "./trace/TracePage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const viewer: SessionUser = { id: "U004", name: "只读访客", username: "viewer", role: "viewer" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
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

async function clickButton(label: string) {
  await act(async () => {
    [...document.querySelectorAll("button")].find(button => button.textContent === label)?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
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

test("history opens on the 90-row minute window and exports the full filter", async () => {
  const source = freshStore();
  const downloads = captureDownloads();
  render(<HistoryPage store={source} user={admin} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("历史检测数据查询");
  expect(getViewSnapshot().filters.history).toBeUndefined();
  expect(document.querySelector<HTMLInputElement>("input[name='start']")?.value).toBe("2026-10-09T14:01");
  expect(document.querySelector<HTMLInputElement>("input[name='end']")?.value).toBe("2026-10-09T14:30");
  expect(document.body.textContent).toContain("共 90 条记录");
  expect(document.body.textContent).not.toContain("共 198 条记录");
  expect(document.body.textContent).not.toContain("共 87 条记录");
  expect(kpi("超限记录")).toBe("2");
  expect(document.querySelectorAll(".chart-host").length).toBe(3);
  await clickButton("导出查询结果");
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toBe("慧眼智检-查询结果-90条.csv");
  const full = csvText(await downloads[0].bytes);
  expect(full.split("\r\n").length - 1).toBe(90);
  expect(source.getState().audits.at(-1)?.action).toBe("导出历史记录");
  expect(source.getState().audits.at(-1)?.detail).toBe("按当前筛选条件导出 90 条记录");

  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少历史筛选");
  act(() => {
    (form.querySelector("[name='query']") as HTMLInputElement).value = "P20261009001";
    (form.querySelector("[name='metric']") as HTMLSelectElement).value = "dg";
    (form.querySelector("[name='judgement']") as HTMLSelectElement).value = "fail";
    form.querySelector<HTMLButtonElement>("button[type='submit']")?.click();
  });
  expect(document.body.textContent).toContain("共 1 条记录");
  await clickButton("导出查询结果");
  expect(downloads[1].name).toBe("慧眼智检-查询结果-1条.csv");
  const one = csvText(await downloads[1].bytes);
  expect(one.split("\r\n").length - 1).toBe(1);
  expect(one).toContain("9.2");
  expect(one).toContain("V1.0");

  const narrowed = document.querySelector("form.filters");
  if (!narrowed) throw new Error("筛选表单已卸载");
  act(() => {
    (narrowed.querySelector("[name='query']") as HTMLInputElement).value = "__missing__";
    narrowed.querySelector<HTMLButtonElement>("button[type='submit']")?.click();
  });
  await clickButton("导出查询结果");
  expect(downloads).toHaveLength(2);
  expect(document.body.textContent).toContain("当前查询无可导出的记录");
  expect(document.body.textContent).toContain("当前条件下没有检测记录");

  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "重置")?.click();
  });
  expect(getViewSnapshot().filters.history).toBeUndefined();
  expect(document.body.textContent).toContain("共 90 条记录");
});

test("history keeps a submitted empty metric and opens the requested record", () => {
  const source = freshStore();
  const fail = source.getState().records.find(record => record.reelId === "P20261009001" && record.value === 9.2);
  if (!fail) throw new Error("缺少搭盖率超限记录");
  render(<HistoryPage store={source} user={viewer} params={new URLSearchParams("metric=dg")} />);
  expect(document.querySelector<HTMLSelectElement>("select[name='metric']")?.value).toBe("dg");
  expect(document.body.textContent).toContain("共 30 条记录");
  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少历史筛选");
  act(() => {
    (form.querySelector("[name='metric']") as HTMLSelectElement).value = "";
    form.querySelector<HTMLButtonElement>("button[type='submit']")?.click();
  });
  expect(document.body.textContent).toContain("共 90 条记录");
  act(() => {
    root?.render(<><HistoryPage store={source} user={viewer} params={new URLSearchParams("metric=jx")} /><ToastViewport /></>);
  });
  expect(document.querySelector<HTMLSelectElement>("select[name='metric']")?.value).toBe("");
  expect(document.body.textContent).toContain("共 90 条记录");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "查看")?.click();
  });
  expect(document.querySelector(".drawer h2")?.textContent).toBe("检测记录详情");
  act(() => {
    document.querySelector<HTMLButtonElement>(".drawer button[aria-label='关闭']")?.click();
  });
  expect(document.querySelector(".drawer")).toBeNull();
  act(() => {
    root?.render(<><HistoryPage store={source} user={viewer} params={new URLSearchParams(`record=${fail.id}`)} /><ToastViewport /></>);
  });
  expect(document.querySelector(".drawer h2")?.textContent).toBe("检测记录详情");
  expect(document.body.textContent).toContain(fail.id);
});

test("trace keeps the seed reel, skips empty charts, and leaves an unknown reel on the page", () => {
  const source = freshStore();
  render(<TracePage store={source} user={admin} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("盘号追溯详情");
  expect(document.body.textContent).toContain("盘号 P20261009001");
  expect(document.body.textContent).toContain("T20261009001");
  expect(document.body.textContent).toContain("AL20261009001");
  expect(document.body.textContent).toContain("预览阶段报告");
  expect(document.querySelectorAll(".chart-host").length).toBe(1);
  expect(document.body.textContent?.split("本盘未关联该项检测").length).toBe(3);
  expect(document.body.textContent).not.toContain("等待量测数据");
  const recipe = source.getState().recipes.find(item => item.metric === "jx" && item.enabled);
  if (!recipe) throw new Error("缺少间隙配方");
  act(() => {
    source.createTask({
      workOrder: "WO-EMPTY",
      reelId: "P-EMPTY",
      specId: "SP110-800",
      metric: "jx",
      deviceId: "HY-JX-01",
      recipeId: recipe.id,
      plannedLength: 100
    });
  });
  act(() => {
    root?.render(<><TracePage store={source} user={admin} params={new URLSearchParams("reel=P-EMPTY")} /><ToastViewport /></>);
  });
  expect(document.body.textContent).toContain("等待量测数据");
  expect(document.querySelectorAll(".chart-host").length).toBe(0);
  act(() => {
    root?.render(<><TracePage store={source} user={viewer} params={new URLSearchParams("reel=NO-SUCH")} /><ToastViewport /></>);
  });
  expect(document.querySelector("h1")?.textContent).toBe("盘号追溯详情");
  expect(document.body.textContent).toContain("盘号 NO-SUCH");
  expect(document.body.textContent).toContain("该盘号不存在检测任务");
  expect(document.querySelectorAll(".chart-host").length).toBe(0);
  act(() => {
    const select = document.querySelector<HTMLSelectElement>("[name='trace-reel']");
    if (select) select.value = "P20261009002";
    [...document.querySelectorAll("button")].find(button => button.textContent === "查询追溯")?.click();
  });
  expect(window.location.hash).toBe("#trace?reel=P20261009002");
  const before = source.getState().reports.length;
  act(() => {
    root?.render(<><TracePage store={source} user={viewer} params={new URLSearchParams()} /><ToastViewport /></>);
  });
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "预览阶段报告")?.click();
  });
  expect(document.body.textContent).toContain(DENY_WRITE_CORE);
  expect(source.getState().reports.length).toBe(before);
});
