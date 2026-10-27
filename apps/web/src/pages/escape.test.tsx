import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { resetViewState } from "../app/viewState";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts } from "../ui/Toast";
import { AlarmPage } from "./alarms/AlarmPage";
import { DevicesPage } from "./devices/DevicesPage";
import { UsersPage } from "./users/UsersPage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const payload = "<img src=x onerror=alert(1)>";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
  if (root) act(() => { root?.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(node); });
}

function expectEscaped(label: string) {
  expect(container?.querySelector("img[src='x']"), label).toBeNull();
  expect(container?.querySelector("[onerror]"), label).toBeNull();
  const nodes = [...(container?.querySelectorAll("h2, td, p, strong") || [])].filter(node => node.textContent === payload);
  expect(nodes.length, label).toBeGreaterThan(0);
  for (const node of nodes) {
    expect(node.children, label).toHaveLength(0);
    expect(node.innerHTML, label).toBe("&lt;img src=x onerror=alert(1)&gt;");
  }
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetViewState();
  resetToasts();
});

test("device names, user names and alarm notes render as text", () => {
  const source = createStore({ persistence: memoryPersistence() });
  source.setSession(admin);
  const device = source.getState().devices[0];
  const user = source.getState().users[0];
  const alarm = source.alarm("AL20261009001");
  if (!device || !user || !alarm) throw new Error("种子缺少设备、用户或报警");
  device.name = payload;
  user.name = payload;
  alarm.history.push({ time: "2026-10-09 14:30:00", actor: payload, note: payload, status: "processing" });

  render(<DevicesPage store={source} user={admin} />);
  expectEscaped("devices");
  expect(container?.querySelector("img[src='assets/images/device-dg.png']")?.getAttribute("alt")).toBe(`${payload}设备外观参考`);
  render(<UsersPage store={source} user={admin} />);
  expectEscaped("users");
  render(<AlarmPage store={source} user={admin} params={new URLSearchParams("id=AL20261009001")} />);
  expectEscaped("alarm");
});
