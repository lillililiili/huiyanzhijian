import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { setSessionUser } from "../../auth/session";
import { createStore, type InspectionStore } from "../../domain/store";
import type { SessionUser } from "../../domain/types";
import { memoryPersistence } from "../../persistence/memoryPersistence";
import { Modal } from "../../ui/Modal";
import { visibleFocusables } from "../../ui/focusTrap";
import { App } from "../App";
import { navigate, resetReturnRoute } from "../hashRoute";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let media: { set(matches: boolean): void } | null = null;

function installMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    media: "(max-width: 1023px)",
    onchange: null,
    addListener(listener: (event: MediaQueryListEvent) => void) { listeners.add(listener); },
    removeListener(listener: (event: MediaQueryListEvent) => void) { listeners.delete(listener); },
    addEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) { listeners.add(listener); },
    removeEventListener(_type: string, listener: (event: MediaQueryListEvent) => void) { listeners.delete(listener); },
    dispatchEvent() { return true; }
  };
  window.matchMedia = () => query as unknown as MediaQueryList;
  return {
    set(next: boolean) {
      query.matches = next;
      for (const listener of [...listeners]) listener({ matches: next, media: query.media } as MediaQueryListEvent);
    }
  };
}

function required<T extends Element = HTMLElement>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`找不到 ${selector}`);
  return node;
}

function setup() {
  const store = createStore({ persistence: memoryPersistence() });
  media = installMatchMedia(true);
  setSessionUser(admin);
  resetReturnRoute();
  window.location.hash = "#dashboard";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return store;
}

function show(node: ReactNode) {
  const localRoot = root;
  if (!localRoot) throw new Error("测试根节点还没有创建");
  act(() => {
    localRoot.render(node);
  });
}

function click(selector: string) {
  const node = required<HTMLElement>(selector);
  act(() => {
    node.click();
  });
}

function press(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

function ModalHarness({ store }: { store: InspectionStore }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="open-test-modal" onClick={() => setOpen(true)}>打开测试对话框</button>
      <App store={store} />
      <Modal title="测试对话框" open={open} onClose={() => setOpen(false)} onSubmit={() => undefined}>
        <input name="probe" aria-label="探针" />
      </Modal>
    </>
  );
}

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      return this.parentElement;
    }
  });
});

afterAll(() => {
  if (originalOffsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
});

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  document.body.className = "";
});

afterEach(() => {
  if (root) act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  media = null;
  setSessionUser(null);
  resetReturnRoute();
  window.location.hash = "";
  document.body.className = "";
});

test("closed mobile sidebar is inert and absent from the accessibility tree", () => {
  const store = setup();
  show(<App store={store} />);
  const sidebar = required<HTMLElement>("#primary-navigation");
  const shell = required<HTMLElement>(".app-shell");
  const menu = required(".mobile-menu");
  expect(sidebar.inert).toBe(true);
  expect(sidebar.getAttribute("aria-hidden")).toBe("true");
  expect(menu.getAttribute("aria-expanded")).toBe("false");
  expect(menu.getAttribute("aria-label")).toBe("展开导航");
  expect(menu.getAttribute("aria-controls")).toBe("primary-navigation");
  expect(shell.inert).toBe(false);
  expect(document.body.classList.contains("nav-open")).toBe(false);
  expect(document.getElementById("main-content")?.className).toBe("page page-dashboard");
  expect(document.getElementById("main-content")?.getAttribute("tabindex")).toBe("-1");
  const labels = [...document.querySelectorAll<HTMLElement>(".nav-scroll .nav-item")].map(node => {
    return [...node.querySelectorAll("span")].find(item => !item.classList.contains("icon"))?.textContent;
  });
  expect(labels).toEqual(["工作台", "综合监控", "检测中心", "检测任务", "产品规格档案", "历史与数据追溯", "报警事件", "分析与质量报告", "质量配置", "设备与接口", "系统管理"]);
  expect(document.querySelector(".voltage")?.textContent).toBe("35\u2013220kV 高压电缆");
  expect(document.querySelector(".sidebar-bottom")?.textContent).toContain("慧眼智检 · 质见未来");
  expect(document.querySelector(".sidebar-bottom")?.textContent).toContain("聚焦三项关键量测指标");
  expect(document.querySelector(".sidebar-bottom")?.textContent).toContain("山东沉积岩信息科技有限公司");
  expect(document.querySelector(".demo-pill")?.getAttribute("href")).toBe("#settings");
  expect(document.querySelector(".demo-time")?.textContent).toBe("2026-10-09 14:30:00");
});

test("opening navigation exposes it, blocks background focus and focuses the current route", () => {
  const store = setup();
  show(<App store={store} />);
  click(".mobile-menu");
  const sidebar = required<HTMLElement>("#primary-navigation");
  const shell = required<HTMLElement>(".app-shell");
  const menu = required(".mobile-menu");
  expect(sidebar.inert).toBe(false);
  expect(sidebar.getAttribute("aria-hidden")).toBe("false");
  expect(shell.inert).toBe(true);
  expect(menu.getAttribute("aria-expanded")).toBe("true");
  expect(menu.getAttribute("aria-label")).toBe("收起导航");
  expect(document.body.classList.contains("nav-open")).toBe(true);
  expect(document.activeElement?.getAttribute("href")).toBe("#dashboard");
});

test("Tab and Shift+Tab wrap within the open mobile navigation", () => {
  const store = setup();
  show(<App store={store} />);
  click(".mobile-menu");
  const nodes = visibleFocusables(required<HTMLElement>("#primary-navigation"));
  expect(nodes[0]?.classList.contains("mobile-nav-close")).toBe(true);
  expect(nodes[nodes.length - 1]?.getAttribute("data-key")).toBe("system");
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  if (!last || !first) throw new Error("侧栏里没有可聚焦的控件");
  act(() => { last.focus(); });
  const forward = press("Tab");
  expect(forward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  const backward = press("Tab", true);
  expect(backward.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
});

test("Escape closes navigation and restores the menu button", () => {
  const store = setup();
  show(<App store={store} />);
  click(".mobile-menu");
  const escaped = press("Escape");
  expect(escaped.defaultPrevented).toBe(true);
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(true);
  expect(required<HTMLElement>(".app-shell").inert).toBe(false);
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(required(".mobile-menu"));
});

test("an active modal takes priority over navigation trapping and Escape", async () => {
  const store = setup();
  show(<ModalHarness store={store} />);
  click(".mobile-menu");
  click(".open-test-modal");
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 40));
  });
  const modal = required<HTMLElement>(".modal");
  const nodes = visibleFocusables(modal);
  const last = nodes[nodes.length - 1];
  const first = nodes[0];
  if (!last || !first) throw new Error("对话框里没有可聚焦的控件");
  act(() => { last.focus(); });
  const tab = press("Tab");
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  act(() => { required(".overlay").click(); });
  expect(document.querySelector(".modal")).not.toBeNull();
  press("Escape");
  expect(document.querySelector(".modal")).toBeNull();
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("true");
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(false);
});

test("an active drawer takes priority over navigation trapping", () => {
  const store = setup();
  show(<App store={store} />);
  click(".avatar");
  click(".mobile-menu");
  const drawer = required<HTMLElement>(".drawer");
  act(() => { required(".drawer-overlay").click(); });
  expect(document.querySelector(".drawer")).toBe(drawer);
  const nodes = visibleFocusables(drawer);
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) throw new Error("账户抽屉里没有可聚焦的控件");
  act(() => { first.focus(); });
  const tab = press("Tab", true);
  expect(tab.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(last);
  expect(last.textContent).toContain("退出登录");
  press("Escape");
  expect(document.querySelector(".drawer")).toBeNull();
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("true");
});

test("route changes close navigation and focus the destination main content", () => {
  const store = setup();
  show(<App store={store} />);
  click(".avatar");
  click(".mobile-menu");
  act(() => {
    navigate("monitor");
  });
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(true);
  expect(required<HTMLElement>(".app-shell").inert).toBe(false);
  expect(document.activeElement).toBe(document.getElementById("main-content"));
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector(".drawer")).toBeNull();

  click(".mobile-menu");
  click("a[href='#monitor']");
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(true);
  expect(document.activeElement).toBe(document.getElementById("main-content"));
  expect(window.location.hash).toBe("#monitor");
});

test("resizing restores desktop navigation and prevents hidden mobile focus", () => {
  const store = setup();
  show(<App store={store} />);
  click(".mobile-menu");
  const current = media;
  if (!current) throw new Error("断点监听还没有装上");
  act(() => { current.set(false); });
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(false);
  expect(required<HTMLElement>(".app-shell").inert).toBe(false);
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement?.getAttribute("href")).toBe("#dashboard");
  act(() => { current.set(true); });
  expect(required<HTMLElement>("#primary-navigation").inert).toBe(true);
  expect(document.activeElement).toBe(required(".mobile-menu"));
});

test("expanding a navigation group retains keyboard focus after rendering", () => {
  const store = setup();
  show(<App store={store} />);
  click(".mobile-menu");
  const group = required<HTMLButtonElement>("[data-nav-group][data-key='detection']");
  act(() => {
    group.focus();
    group.click();
  });
  expect(document.activeElement).toBe(group);
  expect(required(".mobile-menu").getAttribute("aria-expanded")).toBe("true");
  expect(group.getAttribute("aria-expanded")).toBe("false");
});
