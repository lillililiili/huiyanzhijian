import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { resetViewState } from "../app/viewState";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { SpecsPage } from "./specs/SpecsPage";
import { TaskPage } from "./tasks/TaskPage";
import { TasksPage } from "./tasks/TasksPage";

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

function panel(title: string) {
  return [...document.querySelectorAll(".panel")].find(item => item.querySelector("h2")?.textContent === title);
}

async function submitModal() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>("#active-modal-form button[type='submit']")?.click();
  });
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

test("task list counts every task and keeps MES summary words separate", () => {
  const source = freshStore();
  render(<TasksPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("检测任务列表");
  expect(kpi("今日任务总数")).toBe("12");
  expect(kpi("检测中")).toBe("3");
  expect(kpi("已完成")).toBe("9");
  expect(kpi("待复核过程异常")).toBe("1");
  expect(document.body.textContent).not.toContain("今日检测任务");
  expect(document.body.textContent).toContain("共 12 项 · 当前显示 8 项");
  expect(document.body.textContent).toContain("同步中");
  expect(document.body.textContent).toContain("已确认");
  expect(document.body.textContent).not.toContain("待同步");
  expect(document.body.textContent).toContain("每个任务只关联实际适用的检测项目");
  const query = document.querySelector<HTMLInputElement>("input[name='query']");
  if (!query) throw new Error("缺少任务筛选");
  act(() => {
    query.value = "__missing__";
    document.querySelector<HTMLButtonElement>("form.filters button[type='submit']")?.click();
  });
  expect(document.body.textContent).toContain("没有匹配的检测任务");
});

test("creating a task opens its detail and a new task assigns at createdAt", async () => {
  const source = freshStore();
  render(<TasksPage store={source} user={admin} />);
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "新建检测任务")?.click();
  });
  expect(document.querySelector("#modal-title")?.textContent).toBe("新建检测任务");
  await submitModal();
  expect(source.getState().tasks.length).toBe(13);
  expect(window.location.hash.startsWith("#task?id=T")).toBe(true);
  expect(document.body.textContent).toContain("检测任务已创建");
  const created = source.getState().tasks.at(-1);
  if (!created) throw new Error("没有新任务");
  act(() => { root?.render(<><TaskPage store={source} user={admin} params={new URLSearchParams(`id=${created.id}`)} /><ToastViewport /></>); });
  const log = panel("执行日志")?.textContent || "";
  expect(log).toContain("创建检测任务");
  expect(log).toContain("关联设备与检测配方");
  expect(log).toContain("14:30:00");
  expect(log).not.toContain("14:25:00");
  expect(document.body.textContent).toContain("待开始");
});

test("task detail keeps the seed log, blocks a busy device, and stops a viewer", async () => {
  const source = freshStore();
  render(<TaskPage store={source} user={admin} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("检测任务详情");
  expect(document.body.textContent).toContain("T20261009001");
  expect(document.querySelector("a[href='#detection?metric=dg&task=T20261009001']")).toBeTruthy();
  expect(document.body.textContent).not.toContain("DG-V1.0 · V1.0");
  const log = panel("执行日志")?.textContent || "";
  let cursor = -1;
  for (const time of ["12:50:00", "12:55:00", "13:00:00", "14:06:00", "14:07:00", "14:30:00"]) {
    const next = log.indexOf(time, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
  act(() => { root?.render(<><TaskPage store={source} user={admin} params={new URLSearchParams("id=")} /><ToastViewport /></>); });
  expect(document.body.textContent).toContain("T20261009001");
  act(() => { root?.render(<><TaskPage store={source} user={admin} params={new URLSearchParams("id=MISSING")} /><ToastViewport /></>); });
  expect(document.querySelector("h1")?.textContent).toBe("检测任务详情");
  expect(document.body.textContent).toContain("任务不存在");

  const recipe = source.getState().recipes.find(item => item.metric === "dg" && item.enabled);
  if (!recipe) throw new Error("缺少搭盖率配方");
  const recipeId = recipe.id;
  let pendingId = "";
  act(() => {
    pendingId = source.createTask({ workOrder: "WO-NEXT", reelId: "P-NEXT", specId: "SP035-400", metric: "dg", deviceId: "HY-DG-01", recipeId, plannedLength: 1000 }).id;
  });
  const pending = source.task(pendingId);
  if (!pending) throw new Error("没有待开始任务");
  const pendingKey = pending.id;
  act(() => { root?.render(<><TaskPage store={source} user={admin} params={new URLSearchParams(`id=${pendingKey}`)} /><ToastViewport /></>); });
  expect(document.body.textContent).toContain("待开始");
  const before = source.getState().records.length;
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "开始检测")?.click();
  });
  expect(document.body.textContent).toContain("该设备已有检测中的任务，请先完成当前任务");
  expect(source.task(pending.id)?.status).toBe("pending");
  act(() => { source.completeTask("T20261009001"); });
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "开始检测")?.click();
  });
  expect(source.task(pending.id)?.status).toBe("running");
  expect(document.body.textContent).toContain("任务已开始，可模拟采集下一条记录");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "采集下一条")?.click();
  });
  expect(source.getState().records.length).toBe(before + 1);
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "结束检测")?.click();
  });
  expect(document.querySelector("#modal-title")?.textContent).toBe("结束本次检测");
  await submitModal();
  expect(source.task(pending.id)?.status).toBe("completed");
  expect(document.body.textContent).toContain("生成最终报告");
  expect(document.body.textContent).not.toContain("先复核异常");

  source.setSession(viewer);
  const count = source.getState().records.length;
  act(() => { root?.render(<><TaskPage store={source} user={viewer} params={new URLSearchParams("id=T20261009002")} /><ToastViewport /></>); });
  expect([...document.querySelectorAll("button")].some(button => button.textContent === "采集下一条")).toBe(true);
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "采集下一条")?.click();
  });
  expect(source.getState().records.length).toBe(count);
  expect(document.body.textContent).toContain("当前为只读角色，请切换质量管理员或检测操作员后操作");
});

test("finishing the seeded running task links to the unresolved alarm", async () => {
  const source = freshStore();
  render(<TaskPage store={source} user={admin} params={new URLSearchParams("id=T20261009001")} />);
  expect(document.body.textContent).toContain("预览阶段报告");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "结束检测")?.click();
  });
  await submitModal();
  expect(source.task("T20261009001")?.status).toBe("completed");
  const link = [...document.querySelectorAll("a")].find(anchor => anchor.textContent === "先复核异常");
  expect(link?.getAttribute("href")).toBe("#alarm?id=AL20261009001");
  expect([...document.querySelectorAll("button")].some(button => button.textContent === "生成最终报告")).toBe(false);
});

test("specs keep the filtered selection and let quality save without rewriting tasks", async () => {
  const source = freshStore(quality);
  render(<SpecsPage store={source} user={quality} params={new URLSearchParams()} />);
  expect(document.querySelector("h1")?.textContent).toBe("高压电缆产品规格档案");
  expect(document.body.textContent).toContain("SP035-400");
  expect(document.body.textContent).toContain("铜带屏蔽");
  expect(document.body.textContent).toContain("HV-035-400");
  expect(document.body.textContent).toContain("本规格适用");
  expect(document.body.textContent).toContain("本规格不适用");
  act(() => { root?.render(<><SpecsPage store={source} user={quality} params={new URLSearchParams("id=NO-SPEC")} /><ToastViewport /></>); });
  expect(document.querySelector("h1")?.textContent).toBe("高压电缆产品规格档案");
  expect(panel("选中规格详情")?.textContent).toContain("SP035-400");
  const query = document.querySelector<HTMLInputElement>("input[name='query']");
  if (!query) throw new Error("缺少规格筛选");
  act(() => {
    query.value = "__missing__";
    document.querySelector<HTMLButtonElement>("form.filters button[type='submit']")?.click();
  });
  expect(document.body.textContent).toContain("没有匹配的规格");
  expect(document.body.textContent).toContain("请选择产品规格");

  act(() => { root?.render(<><SpecsPage store={source} user={viewer} params={new URLSearchParams()} /><ToastViewport /></>); });
  source.setSession(viewer);
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "新增规格")?.click();
  });
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(source.getState().specs.length).toBe(6);
  expect(document.body.textContent).toContain("当前为只读角色，请切换质量管理员或检测操作员后操作");

  act(() => { resetViewState(); });
  source.setSession(quality);
  act(() => { root?.render(<><SpecsPage store={source} user={quality} params={new URLSearchParams()} /><ToastViewport /></>); });
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "编辑")?.click();
  });
  const area = document.querySelector<HTMLInputElement>("#active-modal-form input[name='area']");
  if (!area) throw new Error("缺少截面积输入");
  act(() => { area.value = "500"; });
  const before = JSON.stringify(source.task("T20261009001")?.ruleSnapshot);
  await submitModal();
  expect(source.spec("SP035-400")?.area).toBe(500);
  expect(source.getState().specs.length).toBe(6);
  expect(JSON.stringify(source.task("T20261009001")?.ruleSnapshot)).toBe(before);
  expect(document.body.textContent).toContain("产品规格已保存");

  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "新增规格")?.click();
  });
  const form = document.querySelector("#active-modal-form");
  const id = form?.querySelector<HTMLInputElement>("input[name='id']");
  const structure = form?.querySelector<HTMLSelectElement>("select[name='structure']");
  if (!id || !structure) throw new Error("缺少规格表单");
  act(() => {
    id.value = "SP-WIRE";
    structure.value = "wire";
  });
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toContain("铜丝屏蔽规格不适用金属屏蔽搭盖率检测");
  expect(source.getState().specs.length).toBe(6);
});
