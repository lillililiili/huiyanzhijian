import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, test } from "vitest";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { RecordDrawer } from "./RecordDrawer";
import { ToastViewport } from "./Toast";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const viewer: SessionUser = { id: "U004", name: "访客", username: "viewer", role: "viewer" };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

test("the record drawer shows the id, rule snapshot and generic pending MES badge", () => {
  const store = createStore({ persistence: memoryPersistence() });
  const record = store.getState().records.find(item => item.metric === "dg" && item.judgement === "fail");
  if (!record) throw new Error("种子缺少超限记录");
  record.mesStatus = "pending";
  record.confirmedAt = null;
  const closed: string[] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <>
        <ToastViewport />
        <RecordDrawer store={store} recordId={record.id} user={admin} open onClose={() => closed.push("close")} />
      </>
    );
  });
  const text = document.body.textContent ?? "";
  expect(text).toContain(record.id);
  expect(text).toContain(record.ruleSnapshot.id);
  expect(text).toContain(`≥ ${record.ruleSnapshot.threshold}`);
  expect(document.body.querySelector(".badge.amber")?.textContent).toBe("待处理");
  expect(text).not.toContain("待同步");
  expect(text).toContain("有效数据");
  expect(text).toContain("关联报警 AL20261009001");
  expect(document.body.querySelector(".image-caption")?.textContent).toBe("AI 生成演示图 · 非现场实测");

  store.setSession(viewer);
  act(() => {
    [...document.body.querySelectorAll("button")].find(button => button.textContent === "模拟MES重试")?.click();
  });
  expect(document.body.textContent).toContain("当前角色为只读");
  expect(store.record(record.id)?.mesStatus).toBe("pending");

  store.setSession(admin);
  act(() => {
    [...document.body.querySelectorAll("button")].find(button => button.textContent === "模拟MES重试")?.click();
  });
  expect(store.record(record.id)?.mesStatus).toBe("confirmed");
  expect(document.body.textContent).toContain("已执行模拟MES重试");
  expect(closed).toEqual([]);
});

test("a missing record closes the drawer instead of rendering an empty shell", () => {
  const store = createStore({ persistence: memoryPersistence() });
  const closed: string[] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <>
        <ToastViewport />
        <RecordDrawer store={store} recordId="missing" user={admin} open onClose={() => closed.push("close")} />
      </>
    );
  });
  expect(document.body.textContent).toContain("记录不存在");
  expect(closed).toEqual(["close"]);
  expect(document.body.querySelector(".drawer")).toBeNull();
});
