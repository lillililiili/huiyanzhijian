import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { getViewSnapshot, resetViewState } from "../app/viewState";
import { DENY_WRITE } from "../auth/permissions";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { DashboardPage } from "./dashboard/DashboardPage";
import { DetectionPage } from "./detection/DetectionPage";
import { HistoryPage } from "./history/HistoryPage";
import { MetricsPage } from "./metrics/MetricsPage";
import { RecipesPage } from "./recipes/RecipesPage";
import { TemplatesPage } from "./templates/TemplatesPage";

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

function panel(title: string) {
  return [...document.querySelectorAll(".panel")].find(item => item.querySelector("h2")?.textContent === title);
}

function kpi(label: string) {
  const node = [...document.querySelectorAll(".kpi-label")].find(item => item.textContent === label);
  return node?.parentElement?.querySelector(".kpi-value")?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function findButton(label: string) {
  return [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
}

function buttons(label: string) {
  return [...document.querySelectorAll("button")].filter(button => button.textContent?.trim() === label);
}

async function clickButton(label: string) {
  await act(async () => { findButton(label)?.click(); });
}

async function submitModal() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>("#active-modal-form button[type='submit']")?.click();
  });
}

function submitFilters() {
  const form = document.querySelector("form.filters");
  if (!form) throw new Error("缺少筛选");
  act(() => { form.querySelector<HTMLButtonElement>("button[type='submit']")?.click(); });
}

function field(name: string) {
  const node = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#active-modal-form [name='${name}']`);
  if (!node) throw new Error(`缺少 ${name}`);
  return node;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetViewState();
  resetToasts();
  window.location.hash = "";
});

test("decimals change the displayed reading and leave meters, counts and rates alone", async () => {
  const source = freshStore();
  render(<MetricsPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("三项检测指标配置");
  const dg = panel("金属屏蔽搭盖率");
  expect(dg?.querySelector("img")?.getAttribute("src")).toBe("assets/images/metric-dg.png");
  expect(dg?.querySelector("img")?.getAttribute("alt")).toBe("搭盖率专题图标");
  expect(dg?.querySelector("strong")?.textContent).toBe("12.36");
  expect(dg?.textContent).toContain("2 位小数");
  expect(dg?.textContent).toContain("DG");
  expect(dg?.textContent).toContain("铜带屏蔽工序的金属屏蔽搭盖率。搭盖宽度与节距为辅助量测。");
  expect(document.querySelector("a[href='#recipes?metric=dg']")?.textContent).toBe("查看配方");
  expect(document.body.textContent).toContain("以记录绑定的规则快照进行判定");
  expect(document.body.textContent).toContain("平均间隙判定，原始分项间隙保留");
  expect(document.body.textContent).toContain("直接采用设备不圆度结果，不编造计算公式");
  expect(buttons("显示设置")).toHaveLength(3);

  await act(async () => { buttons("显示设置")[0].click(); });
  expect(document.querySelector("#modal-title")?.textContent).toBe("搭盖率 · 显示设置");
  expect([...document.querySelectorAll("select[name='decimals'] option")].map(option => option.getAttribute("value"))).toEqual(["0", "1", "2", "3", "4"]);
  (field("decimals") as HTMLSelectElement).value = "0";
  (field("description") as HTMLTextAreaElement).value = "仅供展示";
  await submitModal();
  expect(document.body.textContent).toContain("显示设置已保存。");
  expect(panel("金属屏蔽搭盖率")?.querySelector("strong")?.textContent).toBe("12");
  expect(panel("金属屏蔽搭盖率")?.textContent).not.toContain("12.36");
  expect(panel("金属屏蔽搭盖率")?.textContent).toContain("0 位小数");
  expect(panel("金属屏蔽搭盖率")?.textContent).toContain("仅供展示");
  expect(panel("金属屏蔽搭盖率")?.textContent).toContain("≥ 10 %");
  const saved = source.getState().settings.metricDisplay as { dg: { decimals: number; description: string } };
  expect(saved.dg.decimals).toBe(0);
  expect(source.currentRecords("dg").at(-1)?.value).toBe(12.36);

  render(<DashboardPage store={source} user={admin} />);
  const hero = panel("金属屏蔽搭盖率")?.querySelector(".metric-hero")?.textContent?.replace(/\s+/g, "");
  expect(hero).toBe("12%");
  expect(hero).not.toContain("12.36");

  render(<MetricsPage store={source} user={admin} />);
  await act(async () => { buttons("显示设置")[1].click(); });
  expect(document.querySelector("#modal-title")?.textContent).toBe("铜丝间隙 · 显示设置");
  (field("decimals") as HTMLSelectElement).value = "3";
  (field("description") as HTMLTextAreaElement).value = "";
  await submitModal();
  expect(panel("铜丝屏蔽相邻铜丝间隙")?.textContent).toContain("以相邻铜丝间隙的平均值对照上限。保留每条原始量测记录。");
  const display = source.getState().settings.metricDisplay as { dg: { decimals: number }; jx: { decimals: number; description: string } };
  expect(display.jx.decimals).toBe(3);
  expect(display.jx.description).toBe("");
  expect(display.dg.decimals).toBe(0);

  render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=jx")} />);
  expect(kpi("本窗口平均值")).toBe("1.800 mm");
  expect([...document.querySelectorAll("tbody td:nth-child(2)")].map(cell => cell.textContent)[0]).toBe("2,261.0");
  expect(kpi("控制阈值")).toContain("≤ 3 mm");

  render(<HistoryPage store={source} user={admin} params={new URLSearchParams()} />);
  expect(document.body.textContent).toContain("共 90 条记录");
  expect(document.body.textContent).toContain("97.78%");
});

test("recipe derivation keeps historical snapshots and raw threshold text", async () => {
  const source = freshStore();
  const task = source.task("T20261009001");
  const record = source.recordsFor("T20261009001")[0];
  if (!task || !record) throw new Error("缺少搭盖任务");
  const snapshot = JSON.stringify(task.ruleSnapshot);
  render(<RecipesPage store={source} user={admin} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("配方与判定规则");
  const initial = [...document.querySelectorAll("tbody tr")].map(row => row.textContent || "");
  expect(initial.map(row => row.includes("不圆度") ? "by" : row.includes("铜丝") ? "jx" : "dg")).toEqual(["by", "jx", "dg"]);
  expect(initial.every(row => row.includes("4 项") && row.includes("当前版本"))).toBe(true);
  expect(document.body.textContent).toContain("边界值等于阈值时符合规则");

  const dgRow = [...document.querySelectorAll("tbody tr")].find(row => row.textContent?.includes("搭盖率默认演示配方"));
  await act(async () => { dgRow?.querySelector("button")?.click(); });
  expect(document.querySelector("#modal-title")?.textContent).toBe("创建配方新版本");
  expect(document.querySelector("#active-modal-form")?.textContent).toContain("金属屏蔽搭盖率 · 基于 V1.0 派生");
  expect(document.querySelector("select[name='baseId']")).toBeNull();
  expect(field("baseId").value).toBe("DG-V1.0");
  expect(document.querySelector("#active-modal-form")?.textContent).toContain("控制阈值 / %（下限）");
  expect(document.querySelector("[name='operator']")).toBeNull();
  (field("name") as HTMLInputElement).value = "高要求搭盖配方";
  (field("threshold") as HTMLInputElement).value = "10.25";
  (field("note") as HTMLTextAreaElement).value = "提高搭盖下限";
  await submitModal();
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(document.body.textContent).toContain("新版本已创建，历史规则保持不变。");
  expect(source.recipe("DG-V1.0")?.enabled).toBe(false);
  expect(source.getState().recipes.at(-1)?.id).toBe("DG-V1.1");
  expect(source.getState().recipes.at(-1)?.version).toBe("V1.1");
  expect(source.getState().recipes.at(-1)?.threshold).toBe(10.25);
  expect(source.getState().recipes.at(-1)?.operator).toBe(">=");
  expect(source.getState().recipes.at(-1)?.description).toBe("提高搭盖下限");
  expect(JSON.stringify(source.task("T20261009001")?.ruleSnapshot)).toBe(snapshot);
  expect(record.ruleSnapshot.threshold).toBe(10);
  const nextRows = [...document.querySelectorAll("tbody tr")].map(row => row.textContent || "");
  expect(nextRows[0]).toContain("V1.1");
  expect(nextRows[0]).toContain("10.25");
  expect(nextRows[0]).toContain("当前版本");
  expect(nextRows[0]).toContain("0 项");
  expect(nextRows.at(-1)).toContain("历史版本");
  expect(nextRows.at(-1)).toContain("4 项");
  expect(nextRows.at(-1)).not.toContain("10.25");
  expect(kpi("搭盖率 · 当前规则")).toContain("10.25");

  source.saveMetricDisplay("dg", { decimals: 0, description: "" });
  render(<MetricsPage store={source} user={admin} />);
  const rule = [...document.querySelectorAll(".meta-item")].find(item => item.textContent?.includes("当前控制规则"));
  expect(rule?.textContent).toContain("10.25");
  expect(panel("金属屏蔽搭盖率")?.querySelector("strong")?.textContent).toBe("12");

  render(<RecipesPage store={source} user={admin} params={new URLSearchParams()} />);
  await clickButton("创建配方新版本");
  expect((field("baseId") as HTMLSelectElement).value).toBe("DG-V1.1");
  await act(async () => {
    const select = field("baseId") as HTMLSelectElement;
    select.value = "JX-V1.0";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(field("name").value).toBe("铜丝间隙默认演示配方");
  expect(field("threshold").value).toBe("3");
  expect(document.querySelector("#active-modal-form")?.textContent).toContain("控制阈值 / mm（上限）");
  (field("threshold") as HTMLInputElement).value = "150";
  (field("note") as HTMLTextAreaElement).value = "间隙超过页面检查";
  await submitModal();
  expect(document.querySelector("#modal-title")?.textContent).toBe("创建配方新版本");
  expect(document.querySelector(".form-error")?.textContent).toContain("请输入 0–100 范围内的有效阈值");
  expect(document.querySelector(".form-error")?.textContent).not.toContain("百分比阈值");
  expect(source.getState().recipes).toHaveLength(4);

  await act(async () => {
    const select = field("baseId") as HTMLSelectElement;
    select.value = "DG-V1.1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  (field("threshold") as HTMLInputElement).value = "101";
  (field("note") as HTMLTextAreaElement).value = "百分比超限";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toContain("百分比阈值须在 0–100 范围，间隙阈值须为非负数。");
  (field("threshold") as HTMLInputElement).value = "-1";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toContain("百分比阈值须在 0–100 范围，间隙阈值须为非负数。");
  expect(source.getState().recipes).toHaveLength(4);
  expect(JSON.stringify(source.task("T20261009001")?.ruleSnapshot)).toBe(snapshot);
});

test("recipe metric filter keeps the URL when the submitted metric is empty", () => {
  const source = freshStore();
  render(<RecipesPage store={source} user={admin} params={new URLSearchParams("metric=jx")} />);
  expect(getViewSnapshot().filters.recipes).toBeUndefined();
  expect(document.querySelector<HTMLSelectElement>("select[name='metric']")?.value).toBe("jx");
  expect([...document.querySelectorAll("tbody tr")].map(row => row.textContent || "").every(row => row.includes("铜丝"))).toBe(true);
  expect(document.querySelectorAll("tbody tr")).toHaveLength(1);

  const select = document.querySelector<HTMLSelectElement>("select[name='metric']");
  if (!select) throw new Error("缺少检测项目");
  select.value = "";
  submitFilters();
  expect(getViewSnapshot().filters.recipes?.metric).toBe("");
  expect(document.querySelector<HTMLSelectElement>("select[name='metric']")?.value).toBe("jx");
  expect(document.querySelectorAll("tbody tr")).toHaveLength(1);

  const again = document.querySelector<HTMLSelectElement>("select[name='metric']");
  if (!again) throw new Error("缺少检测项目");
  again.value = "dg";
  submitFilters();
  expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(document.querySelector("tbody tr")?.textContent).toContain("搭盖率");

  act(() => { findButton("重置")?.click(); });
  expect(getViewSnapshot().filters.recipes).toBeUndefined();
  expect(document.querySelector<HTMLSelectElement>("select[name='metric']")?.value).toBe("jx");
  expect(document.querySelector("tbody tr")?.textContent).toContain("铜丝");
});

test("recipe creation stays closed when no base recipe exists", async () => {
  const source = freshStore();
  source.getState().recipes.splice(0, source.getState().recipes.length);
  render(<RecipesPage store={source} user={admin} params={new URLSearchParams()} />);
  await clickButton("创建配方新版本");
  expect(document.body.textContent).toContain("未找到基础配方。");
  expect(document.querySelector("#modal-title")).toBeNull();
});

test("template save writes revision 2 and leaves older snapshots unchanged", async () => {
  const source = freshStore();
  const prior = source.getState().reports[0];
  if (!prior) throw new Error("缺少种子报告");
  const original = JSON.stringify(prior.snapshot);
  render(<TemplatesPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("报告模板配置");
  expect(document.querySelector(".panel img")?.getAttribute("src")).toBe("assets/images/logo.png");
  expect(document.querySelector(".panel img")?.getAttribute("alt")).toBe("慧眼智检");
  expect(document.body.textContent).toContain("已启用：量测趋势");
  expect(document.body.textContent).toContain("已启用：报警与复核记录");
  expect(document.body.textContent).toContain("已启用：全部量测明细");
  expect(document.body.textContent).toContain("签审栏是报告展示内容。原型不模拟有效电子签名或生产放行授权。");
  expect(document.body.textContent).toContain("保持原始快照");

  await clickButton("编辑报告模板");
  for (const name of ["includeLogo", "includeTrend", "includeAlarms", "includeDetails"]) {
    expect((field(name) as HTMLInputElement).checked).toBe(true);
  }
  (field("title") as HTMLInputElement).value = "新的报告抬头";
  (field("includeTrend") as HTMLInputElement).checked = false;
  await submitModal();
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(document.body.textContent).toContain("模板已保存，之后生成的报告将使用此版本。");
  expect(document.body.textContent).toContain("V1.1");
  expect(document.body.textContent).toContain("新的报告抬头");
  expect(document.body.textContent).not.toContain("已启用：量测趋势");
  expect(document.body.textContent).toContain("已启用：报警与复核记录");
  expect(document.body.textContent).toContain("已启用：全部量测明细");
  const saved = source.getState().reportTemplate;
  expect(saved.revision).toBe(2);
  expect(saved.version).toBe("V1.1");
  expect(saved.title).toBe("新的报告抬头");
  expect(saved.header).toBe("新的报告抬头");
  expect(saved.includeLogo).toBe(true);
  expect(saved.includeTrend).toBe(false);
  expect(saved.includeAlarms).toBe(true);
  expect(saved.includeDetails).toBe(true);
  expect(saved.signatory).toBe("质量管理员");
  expect(JSON.stringify(prior.snapshot)).toBe(original);
  expect(prior.snapshot.template.title).toBe("高压电缆质量检测报告");

  const created = source.createReport("T20261009003");
  expect(created.snapshot.template.title).toBe("新的报告抬头");
  expect(created.snapshot.template.includeTrend).toBe(false);
  expect(JSON.stringify(prior.snapshot)).toBe(original);
});

test("viewer still sees the write buttons and is refused before the dialog", async () => {
  const source = freshStore(viewer);
  const before = JSON.stringify({
    recipes: source.getState().recipes,
    template: source.getState().reportTemplate,
    display: source.getState().settings.metricDisplay ?? null
  });
  render(<MetricsPage store={source} user={viewer} />);
  expect(findButton("显示设置")).toBeTruthy();
  await clickButton("显示设置");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();

  act(() => { resetToasts(); });
  render(<RecipesPage store={source} user={viewer} params={new URLSearchParams()} />);
  expect(findButton("创建配方新版本")).toBeTruthy();
  expect(findButton("派生新版本")).toBeTruthy();
  await clickButton("创建配方新版本");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();
  act(() => { resetToasts(); });
  await clickButton("派生新版本");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();

  act(() => { resetToasts(); });
  render(<TemplatesPage store={source} user={viewer} />);
  expect(findButton("编辑报告模板")).toBeTruthy();
  await clickButton("编辑报告模板");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(JSON.stringify({
    recipes: source.getState().recipes,
    template: source.getState().reportTemplate,
    display: source.getState().settings.metricDisplay ?? null
  })).toBe(before);
});

test("quality can save display, recipe and template", async () => {
  const source = freshStore(quality);
  render(<MetricsPage store={source} user={quality} />);
  await clickButton("显示设置");
  (field("decimals") as HTMLSelectElement).value = "4";
  (field("description") as HTMLTextAreaElement).value = "质量说明";
  await submitModal();
  const display = source.getState().settings.metricDisplay as { dg: { decimals: number; description: string } };
  expect(display.dg.decimals).toBe(4);
  expect(display.dg.description).toBe("质量说明");

  render(<RecipesPage store={source} user={quality} params={new URLSearchParams()} />);
  await clickButton("创建配方新版本");
  (field("threshold") as HTMLInputElement).value = "11";
  (field("note") as HTMLTextAreaElement).value = "质量修订阈值";
  await submitModal();
  expect(source.getState().recipes.at(-1)?.version).toBe("V1.1");
  expect(source.getState().recipes.at(-1)?.threshold).toBe(11);
  expect(source.recipe("DG-V1.0")?.enabled).toBe(false);

  render(<TemplatesPage store={source} user={quality} />);
  await clickButton("编辑报告模板");
  (field("title") as HTMLInputElement).value = "质量报告抬头";
  await submitModal();
  expect(source.getState().reportTemplate.revision).toBe(2);
  expect(source.getState().reportTemplate.version).toBe("V1.1");
  expect(source.getState().reportTemplate.title).toBe("质量报告抬头");
  expect(source.getState().reportTemplate.includeTrend).toBe(true);
});
