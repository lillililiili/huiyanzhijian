import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { resetViewState } from "../app/viewState";
import { createStore, type InspectionStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { DashboardPage } from "./dashboard/DashboardPage";
import { DetectionPage, resetDetectionPlayback } from "./detection/DetectionPage";
import { MonitorPage } from "./monitor/MonitorPage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(node); });
}

function freshStore() {
  return createStore({ persistence: memoryPersistence() });
}

function replaceRunningDg(source: InspectionStore) {
  source.completeTask("T20261009001");
  const recipe = source.getState().recipes.find(item => item.metric === "dg" && item.enabled);
  if (!recipe) throw new Error("缺少搭盖率配方");
  const task = source.createTask({
    workOrder: "WO-REGRESSION",
    reelId: "P-REGRESSION",
    specId: "SP035-400",
    metric: "dg",
    deviceId: "HY-DG-01",
    recipeId: recipe.id,
    plannedLength: 1000
  });
  source.startTask(task.id);
  return task;
}

function kpi(label: string) {
  const node = [...document.querySelectorAll(".kpi-label")].find(item => item.textContent === label);
  return node?.parentElement?.querySelector(".kpi-value")?.textContent || "";
}

function hero(title: string) {
  const panel = [...document.querySelectorAll(".panel")].find(item => item.querySelector("h2")?.textContent === title);
  return panel?.querySelector(".metric-hero strong")?.textContent || "";
}

afterEach(() => {
  vi.useRealTimers();
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetDetectionPlayback();
  resetViewState();
  window.location.hash = "";
});

test("dashboard shows twelve tasks and the running-task window", () => {
  const source = freshStore();
  render(<DashboardPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("工作台首页");
  expect(kpi("今日检测任务")).toBe("12");
  expect(document.body.textContent).toContain("检测中 3 · 已完成 9");
  expect(hero("金属屏蔽搭盖率")).toBe("12.36%");
  expect(hero("铜丝屏蔽相邻铜丝间隙")).toBe("1.52mm");
  expect(hero("电缆不圆度")).toBe("4.37%");
  expect(document.body.textContent).toContain("当前值符合阈值不代表整盘最终合格");
  const before = source.getState().records.length;
  act(() => { replaceRunningDg(source); });
  expect(hero("金属屏蔽搭盖率")).toBe("—%");
  expect(document.body.textContent).not.toContain("12.36");
  expect(source.getState().records.length).toBe(before);
});

test("monitor keeps 12.36 off an empty running device and uses 空闲 only for task status", () => {
  const source = freshStore();
  render(<MonitorPage store={source} />);
  expect(document.querySelector("h1")?.textContent).toBe("产线与设备实时总览");
  expect(hero("金属屏蔽搭盖率")).toBe("12.36%");
  expect(document.body.textContent).not.toContain("空闲");
  act(() => { replaceRunningDg(source); });
  expect(hero("金属屏蔽搭盖率")).toBe("—%");
  const runningCard = [...document.querySelectorAll(".monitor-card")].find(item => item.querySelector("h2")?.textContent === "金属屏蔽搭盖率");
  expect(runningCard?.textContent).toContain("暂无数据");
  expect(runningCard?.textContent).toContain("检测中");
  expect(runningCard?.textContent).not.toContain("12.36");
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  const idleStore = freshStore();
  act(() => { idleStore.completeTask("T20261009001"); });
  render(<MonitorPage store={idleStore} />);
  const idleCard = [...document.querySelectorAll(".monitor-card")].find(item => item.querySelector("h2")?.textContent === "金属屏蔽搭盖率");
  expect(idleCard?.textContent).toContain("空闲");
  expect(idleCard?.textContent).toContain("暂无数据");
  expect(hero("金属屏蔽搭盖率")).toBe("—%");
  const select = document.querySelector<HTMLSelectElement>("select[name='line']");
  if (!select) throw new Error("缺少产线筛选");
  act(() => {
    select.value = "铜丝屏蔽工位";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>("button[type='submit']")?.click();
  });
  expect(document.querySelectorAll(".monitor-card")).toHaveLength(1);
  expect(document.querySelector(".monitor-card h2")?.textContent).toBe("铜丝屏蔽相邻铜丝间隙");
});

test("detection keeps each metric, rejects a missing task, and replays without collecting", () => {
  const source = freshStore();
  const count = source.getState().records.length;
  window.location.hash = "#detection?metric=dg";
  render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=dg")} />);
  expect(document.querySelector("h1")?.textContent).toBe("金属屏蔽搭盖率检测");
  expect(document.body.textContent).toContain("T20261009001");
  expect(document.body.textContent).toContain("30 条有效量测记录");
  expect(kpi("当前搭盖率")).toContain("12.36");

  vi.useFakeTimers();
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "检测回放")?.click();
  });
  expect(document.body.textContent).toContain("1 条有效量测记录");
  expect(document.body.textContent).toContain("暂停回放");
  act(() => { vi.advanceTimersByTime(5000); });
  expect(document.body.textContent).toContain("2 条有效量测记录");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "回到当前")?.click();
  });
  expect(document.body.textContent).toContain("30 条有效量测记录");
  expect(source.getState().records.length).toBe(count);
  vi.useRealTimers();

  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=jx")} />); });
  expect(document.querySelector("h1")?.textContent).toBe("铜丝屏蔽相邻铜丝间隙检测");
  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=by")} />); });
  expect(document.querySelector("h1")?.textContent).toBe("电缆不圆度检测");
  expect(document.body.textContent).toContain("外径为本项检测的辅助数据");
  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=foo")} />); });
  expect(document.querySelector("h1")?.textContent).toBe("金属屏蔽搭盖率检测");
  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("task=MISSING")} />); });
  expect(document.querySelector("h1")?.textContent).toBe("检测任务不存在");
  expect(document.body.textContent).toContain("未找到指定检测任务");

  let taskId = "";
  act(() => { taskId = replaceRunningDg(source).id; });
  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=dg")} />); });
  expect(document.body.textContent).toContain(taskId);
  expect(document.body.textContent).not.toContain("12.36");
  expect(document.body.textContent).not.toContain("AL20261009001");
  expect(document.body.textContent).toContain("等待有效记录");
  act(() => { root?.render(<DetectionPage store={source} user={admin} params={new URLSearchParams("metric=dg&task=T20261009001")} />); });
  expect(kpi("当前搭盖率")).toContain("12.36");
  expect(document.body.textContent).toContain("30 条有效量测记录");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "查看")?.click();
  });
  expect(document.body.textContent).toContain("记录编号");
});
