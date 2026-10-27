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
import { resetImportPreview } from "./import/importPreview";
import { ImportPage } from "./import/ImportPage";
import { TracePage } from "./trace/TracePage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const quality: SessionUser = { id: "U003", name: "质量审核员", username: "quality", role: "quality" };
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

function chooseFile(name: string, content: string, size?: number) {
  const file = new File([content], name, { type: "text/csv" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  const input = document.querySelector<HTMLInputElement>("#core-import-file");
  if (!input) throw new Error("缺少文件选择");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
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
  resetImportPreview();
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

test("import previews every checked row, saves only passing rows, and keeps store line numbers off the CSV", async () => {
  const source = freshStore(quality);
  const before = source.getState().records.length;
  render(<ImportPage store={source} user={quality} />);
  expect(document.querySelector("h1")?.textContent).toBe("数据导入与补录");
  expect(document.body.textContent).toContain("选择 CSV 文件或新增补录，校验结果将在这里展示");
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("请先选择 CSV 文件");
  chooseFile("big.csv", "taskId,metric,time,meter,value\nT1,dg,2026-10-09 14:31:00,1,12\n", 5 * 1024 * 1024 + 1);
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("请将单个导入文件控制在 5MB 以内");
  chooseFile("bad.csv", "name,value\nA,1\n");
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("CSV 缺少必要表头：taskId, metric, time, meter, value");

  const mixed = [
    "taskId,metric,time,meter,value,validity",
    "MISSING,dg,2026-10-09 14:31:00,10,12,valid",
    "T20261009001,dg,2026-10-09 14:31:00,1240,12.5,valid",
    "T20261009001,dg,2026-10-09 14:31:00,1240,12.5,valid"
  ].join("\n");
  chooseFile("mixed.csv", mixed);
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("文件校验完成，请查看预览");
  expect(document.body.textContent).toContain("3 条待导入");
  expect(document.body.textContent).toContain("2 条通过");
  expect(document.body.textContent).toContain("1 条错误");
  expect(document.body.textContent).toContain("任务不存在");
  const csvRows = [...document.querySelectorAll("tbody tr td:first-child")].map(cell => cell.textContent);
  expect(csvRows).toEqual(["2", "3", "4"]);
  await clickButton("保存校验通过的记录");
  expect(document.body.textContent).toContain("已保存 1 条记录，1 条被拒绝");
  expect(document.body.textContent).toContain("成功 1 条，失败 1 条。");
  const drawer = document.querySelector(".drawer")?.textContent || "";
  expect(drawer).toContain("提交序号 2 · line 3 · 同一任务、时间和米数的记录已存在");
  expect(drawer).not.toContain("line 2");
  expect(drawer).not.toContain("line 4");
  expect(drawer).not.toContain("CSV行");
  expect(source.getState().records.length).toBe(before + 1);
  expect(source.getState().records.at(-1)?.source).toBe("人工导入补录");
  expect(document.body.textContent).toContain("选择 CSV 文件或新增补录，校验结果将在这里展示");
});

test("import shows 100 preview rows, saves every passing row, and blocks a viewer", async () => {
  const source = freshStore(quality);
  const before = source.getState().records.length;
  render(<ImportPage store={source} user={quality} />);
  const lines = ["taskId,metric,time,meter,value,validity"];
  for (let index = 0; index < 101; index += 1) {
    const minute = String(Math.floor(index / 60)).padStart(2, "0");
    const second = String(index % 60).padStart(2, "0");
    lines.push(`T20261009001,dg,2026-10-09 15:${minute}:${second},${index + 1},12.5,valid`);
  }
  chooseFile("many.csv", lines.join("\n"));
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("预览仅展示前100行；保存处理全部校验通过的记录。");
  expect(document.querySelectorAll("tbody tr").length).toBe(100);
  await clickButton("保存校验通过的记录");
  expect(source.getState().records.length).toBe(before + 101);
  expect(source.getState().records.at(-1)?.source).toBe("人工导入补录");

  const tooMany = `taskId,metric,time,meter,value\n${"T20261009001,dg,2026-10-09 14:31:00,1,12\n".repeat(10001)}`;
  chooseFile("over.csv", tooMany);
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("单次最多导入 10,000 条记录");
  expect(document.body.textContent).not.toContain("10001 条待导入");

  act(() => {
    root?.render(<><ImportPage store={source} user={viewer} /><ToastViewport /></>);
  });
  chooseFile("one.csv", "taskId,metric,time,meter,value\nT20261009001,dg,2026-10-09 16:10:00,1600,12.4,valid\n");
  await clickButton("读取并校验文件");
  expect(document.body.textContent).toContain("可导入");
  const locked = source.getState().records.length;
  await clickButton("保存校验通过的记录");
  expect(document.body.textContent).toContain(DENY_WRITE_CORE);
  expect(source.getState().records.length).toBe(locked);
  expect(document.body.textContent).toContain("可导入");
  await clickButton("新增一条补录");
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(document.body.textContent).toContain(DENY_WRITE_CORE);
});

test("manual entry and the template download stay on the shared preview", async () => {
  const source = freshStore(quality);
  const downloads = captureDownloads();
  render(<ImportPage store={source} user={quality} />);
  await clickButton("下载 CSV 模板");
  expect(downloads[0].name).toBe("慧眼智检-检测数据导入模板.csv");
  const template = csvText(await downloads[0].bytes);
  expect(template.startsWith("taskId,metric,time,meter,value,validity\r\nT20261009001,dg,2026-10-09 14:31:00,1240,12.36,valid\r\n")).toBe(true);
  await clickButton("新增一条补录");
  expect(document.querySelector("#modal-title")?.textContent).toBe("补录检测数据");
  const value = document.querySelector<HTMLInputElement>("#active-modal-form input[name='value']");
  const time = document.querySelector<HTMLInputElement>("#active-modal-form input[name='time']");
  if (!value || !time) throw new Error("缺少补录表单");
  time.value = "2026-10-09T14:32";
  value.value = "12.8";
  await act(async () => {
    document.querySelector<HTMLButtonElement>("#active-modal-form button[type='submit']")?.click();
  });
  expect(document.body.textContent).toContain("补录已校验，请在预览中保存");
  expect(document.body.textContent).toContain("人工补录");
  expect(document.body.textContent).toContain("2026-10-09 14:32:00");
  expect(document.querySelector("tbody tr td")?.textContent).toBe("1");
  const before = source.getState().records.length;
  await clickButton("保存校验通过的记录");
  expect(source.getState().records.length).toBe(before + 1);
  expect(source.getState().records.at(-1)?.source).toBe("人工导入补录");
  expect(source.getState().records.at(-1)?.time).toBe("2026-10-09 14:32:00");
  expect(window.location.hash).toBe("#import");
});
