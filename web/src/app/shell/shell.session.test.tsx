import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, test } from "vitest";
import { getSession, REMEMBER_KEY, SESSION_KEY, setSessionUser } from "../../auth/session";
import { createStore } from "../../domain/store";
import type { SessionUser } from "../../domain/types";
import { memoryPersistence } from "../../persistence/memoryPersistence";
import { App } from "../App";
import { navigate, resetReturnRoute } from "../hashRoute";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };

const pages: Array<[string, string, string]> = [
  ["dashboard", "工作台首页", "工作台首页"],
  ["monitor", "产线与设备实时总览", "产线与设备实时总览"],
  ["detection?metric=dg", "金属屏蔽搭盖率检测", "金属屏蔽搭盖率检测"],
  ["detection?metric=jx", "铜丝屏蔽相邻铜丝间隙检测", "铜丝屏蔽相邻铜丝间隙检测"],
  ["detection?metric=by", "电缆不圆度检测", "电缆不圆度检测"],
  ["detection?metric=foo", "undefined检测", "金属屏蔽搭盖率检测"],
  ["tasks", "检测任务列表", "检测任务列表"],
  ["task", "检测任务详情", "检测任务详情"],
  ["specs", "高压电缆产品规格档案", "高压电缆产品规格档案"],
  ["history", "历史检测数据查询", "历史检测数据查询"],
  ["trace", "盘号追溯详情", "盘号追溯详情"],
  ["import", "数据导入与补录", "数据导入与补录"],
  ["alarms", "报警事件", "报警事件"],
  ["alarm", "报警详情与处置", "报警详情与处置"],
  ["analytics", "质量统计分析", "质量统计分析"],
  ["reports", "质量报告管理", "质量报告管理"],
  ["report", "报告预览与导出", "报告预览与导出"],
  ["metrics", "三项检测指标配置", "三项检测指标配置"],
  ["recipes", "配方与判定规则", "配方与判定规则"],
  ["templates", "报告模板配置", "报告模板配置"],
  ["devices", "设备档案", "设备档案"],
  ["connections", "数据接入配置", "数据接入配置"],
  ["mes", "MES接口配置", "MES 接口配置"],
  ["sync", "同步监控", "MES 同步监控"],
  ["users", "用户角色与权限", "用户角色与权限"],
  ["audit", "操作审计", "操作审计"],
  ["settings", "系统设置与运行状态", "系统设置与运行状态"]
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installMatchMedia() {
  const query = {
    matches: false,
    media: "(max-width: 1023px)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; }
  };
  window.matchMedia = () => query as unknown as MediaQueryList;
}

function required<T extends Element = HTMLElement>(selector: string) {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`找不到 ${selector}`);
  return node;
}

function renderApp(hash: string, session: SessionUser | null = null) {
  installMatchMedia();
  setSessionUser(session);
  resetReturnRoute();
  window.location.hash = hash;
  const store = createStore({ persistence: memoryPersistence() });
  container = document.createElement("div");
  document.body.appendChild(container);
  const localRoot = createRoot(container);
  root = localRoot;
  act(() => {
    localRoot.render(<App store={store} />);
  });
  return store;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function chooseRole(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(".role-tabs button")].find(item => item.textContent === label);
  if (!button) throw new Error(`找不到身份 ${label}`);
  act(() => { button.click(); });
}

function submitLogin() {
  act(() => { required<HTMLButtonElement>(".login-submit").click(); });
}

function go(hash: string) {
  act(() => {
    navigate(hash);
  });
}

afterEach(() => {
  if (root) act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  setSessionUser(null);
  resetReturnRoute();
  sessionStorage.clear();
  localStorage.clear();
  window.location.hash = "";
});

test("an empty hash stays on the login page", () => {
  renderApp("");
  expect(window.location.hash === "" || window.location.hash === "#login").toBe(true);
  expect(document.querySelector("h1")?.textContent).toBe("慧眼智检");
  expect(document.body.textContent).toContain("欢迎登录");
  expect(getSession()).toBeNull();
  expect(document.title).toBe("登录 · 慧眼智检");
  expect(required("#login-password").getAttribute("minlength")).toBe("4");
  expect(required(".login-top img").getAttribute("src")).toBe("assets/images/logo.png");
  expect(required(".family-photo img").getAttribute("src")).toBe("assets/images/device-family.png");
  expect(document.body.textContent).toContain("35\u2013220kV");
});

test("an unauthenticated deep link returns to that route after login", () => {
  const store = renderApp("#monitor");
  expect(window.location.hash).toBe("#login");
  expect(document.body.textContent).toContain("欢迎登录");
  chooseRole("质量管理员");
  submitLogin();
  expect(window.location.hash).toBe("#monitor");
  expect(document.querySelector("#main-content h1")?.textContent).toBe("产线与设备实时总览");
  expect(document.title).toBe("产线与设备实时总览 · 慧眼智检");
  expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null")).toEqual(admin);
  const entry = store.getState().audits.find(item => item.action === "登录系统" && item.detail === "以 admin 角色登录本地原型");
  expect(entry?.detail).toBe("以 admin 角色登录本地原型");
  expect(entry?.actor).toBe("质量管理员");
  expect(entry?.role).toBe("admin");
  expect(JSON.stringify(entry)).not.toContain("demo1234");
});

test("a signed-in visit to login goes to the dashboard", () => {
  renderApp("#login", admin);
  expect(window.location.hash).toBe("#dashboard");
  expect(document.querySelector("#main-content h1")?.textContent).toBe("工作台首页");
  expect(document.querySelector("a.nav-item[href='#dashboard']")?.textContent).toBe("工作台");
});

test("the remembered account prefills the form without a password", () => {
  localStorage.setItem(REMEMBER_KEY, "operator");
  renderApp("#login");
  expect(required<HTMLInputElement>("#login-account").value).toBe("operator");
  expect(required<HTMLInputElement>("#login-password").value).toBe("");
  expect(required<HTMLInputElement>("input[name=remember]").checked).toBe(true);
});

test("checking remember stores the account and clearing it removes the key", () => {
  const store = renderApp("#login");
  chooseRole("检测操作员");
  required<HTMLInputElement>("input[name=remember]").checked = true;
  submitLogin();
  expect(localStorage.getItem(REMEMBER_KEY)).toBe("operator");
  expect(store.getState().audits.some(item => item.action === "登录系统" && item.detail === "以 quality 角色登录本地原型")).toBe(true);
  act(() => { root?.unmount(); });
  container?.remove();
  setSessionUser(null);
  resetReturnRoute();
  renderApp("#login");
  expect(required<HTMLInputElement>("#login-account").value).toBe("operator");
  required<HTMLInputElement>("input[name=remember]").checked = false;
  chooseRole("只读访客");
  submitLogin();
  expect(localStorage.getItem(REMEMBER_KEY)).toBeNull();
  expect(getSession()?.username).toBe("viewer");
});

test("a missing account does not open a session", () => {
  renderApp("#login");
  setValue(required("#login-account"), "nobody");
  setValue(required("#login-password"), "demo1234");
  submitLogin();
  expect(document.querySelector(".login-form .form-error")?.textContent).toBe("账号不存在或已停用，请选择演示身份。");
  expect(getSession()).toBeNull();
  expect(window.location.hash).toBe("#login");
  expect(required("#login-password").getAttribute("minlength")).toBe("4");
});

test("quality can sign in by typing and is not a shortcut", () => {
  const store = renderApp("#login");
  const labels = [...document.querySelectorAll(".role-tabs button")].map(button => button.textContent);
  expect(labels).toEqual(["质量管理员", "检测操作员", "只读访客"]);
  setValue(required("#login-account"), "quality");
  setValue(required("#login-password"), "demo1234");
  submitLogin();
  expect(getSession()).toEqual({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  expect(store.getState().audits.some(item => item.detail === "以 quality 角色登录本地原型")).toBe(true);
});

test("the three identity buttons fill admin, operator and viewer with the demo password", () => {
  renderApp("#login");
  const account = required<HTMLInputElement>("#login-account");
  const password = required<HTMLInputElement>("#login-password");
  const buttons = [...document.querySelectorAll(".role-tabs button")];
  expect(account.value).toBe("");
  expect(password.value).toBe("");
  expect(buttons[0]?.classList.contains("active")).toBe(true);
  chooseRole("质量管理员");
  expect(account.value).toBe("admin");
  expect(password.value).toBe("demo1234");
  chooseRole("检测操作员");
  expect(account.value).toBe("operator");
  expect(password.value).toBe("demo1234");
  chooseRole("只读访客");
  expect(account.value).toBe("viewer");
  expect(password.value).toBe("demo1234");
  expect(window.location.hash).toBe("#login");
  const submit = required(".login-submit");
  expect(submit.textContent).toContain("登录系统");
  expect(submit.querySelector(".icon")?.getAttribute("style")).toContain("21px");
});

test("logout records the audit before clearing the session", () => {
  const store = renderApp("#dashboard", admin);
  act(() => { required(".avatar").click(); });
  expect(document.querySelector(".drawer h2")?.textContent).toBe("当前账户");
  expect(document.body.textContent).toContain("当前会话仅用于本地原型的操作权限演示。");
  expect(document.querySelector(".drawer .badge")?.textContent).toBe("系统管理员");
  expect(document.querySelector(".drawer .badge")?.className).toContain("blue");
  const logout = [...document.querySelectorAll("button")].find(button => button.textContent?.includes("退出登录"));
  if (!logout) throw new Error("找不到退出登录");
  act(() => { logout.click(); });
  expect(window.location.hash).toBe("#login");
  expect(getSession()).toBeNull();
  expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  expect(document.body.textContent).toContain("欢迎登录");
  const entry = store.getState().audits.find(item => item.action === "退出登录");
  expect(entry?.detail).toBe("退出本地演示会话");
  expect(entry?.actor).toBe("质量管理员");
  expect(entry?.role).toBe("admin");
});

test("the contact dialog and login footer keep the prototype copy", () => {
  renderApp("#login");
  const footer = required(".login-bottom").textContent || "";
  expect(footer).toContain("山东沉积岩信息科技有限公司");
  expect(footer).toContain("慧眼智检 · 质见未来");
  expect(footer).toContain("设备外观参考产品手册");
  expect(footer).toContain("localhost 与 127.0.0.1 是不同的存储来源");
  act(() => {
    [...document.querySelectorAll("button")].find(button => button.textContent === "联系管理员")?.click();
  });
  expect(document.querySelector("#modal-title")?.textContent).toBe("联系管理员");
  expect(document.body.textContent).toContain("本地原型无需开通真实账号。可选择下方演示身份后登录。");
  expect(document.body.textContent).toContain("所属机构：山东沉积岩信息科技有限公司");
  expect(document.body.textContent).toContain("admin");
  expect(document.body.textContent).toContain("operator");
  expect(document.body.textContent).toContain("viewer");
  expect([...document.querySelectorAll(".modal button")].some(button => button.textContent === "知道了")).toBe(true);
});

test("placeholder pages keep sidebar, breadcrumb and heading text apart", () => {
  renderApp("#dashboard", admin);
  expect(required(".bellbox").getAttribute("aria-label")).toBe("查看待复核报警");
  act(() => { required(".bellbox").click(); });
  expect(window.location.hash).toBe("#alarms");

  for (const [hash, crumb, heading] of pages) {
    go(hash);
    const actualCrumb = document.querySelector(".breadcrumb strong")?.textContent;
    const actualHeading = document.querySelector("#main-content h1")?.textContent;
    const route = hash.split("?")[0] || hash;
    const title = `${hash.startsWith("detection") ? "检测中心" : crumb} · 慧眼智检`;
    if (actualCrumb !== crumb || actualHeading !== heading || document.title !== title) {
      throw new Error(`#${hash} 面包屑 ${actualCrumb} / 标题 ${actualHeading} / 文档 ${document.title}`);
    }
    if (document.getElementById("main-content")?.className !== `page page-${route}`) {
      throw new Error(`#${hash} 页面 class 不正确`);
    }
    if (hash === "dashboard" && document.querySelector("a.nav-item.active")?.textContent !== "工作台") {
      throw new Error("工作台侧栏不应使用面包屑文案");
    }
    if (hash === "task" && !document.querySelector("a[href='#tasks']")?.classList.contains("active")) {
      throw new Error("任务详情应高亮检测任务");
    }
    if (hash === "alarm" && !document.querySelector("a[href='#alarms']")?.classList.contains("active")) {
      throw new Error("报警详情应高亮报警事件");
    }
    if (hash === "report" && document.querySelector("[data-key='reports']")?.getAttribute("aria-expanded") !== "true") {
      throw new Error("报告详情应展开报告分组");
    }
    if (hash === "detection?metric=jx" && document.querySelector("a[href='#detection?metric=jx']")?.className !== "active") {
      throw new Error("间隙检测子项应处于当前状态");
    }
    if (hash === "mes" && document.querySelector("a[href='#mes']")?.textContent !== "MES接口配置") {
      throw new Error("MES 侧栏不应带空格");
    }
    if (hash === "sync" && document.querySelector("a[href='#sync']")?.textContent !== "同步监控") {
      throw new Error("同步监控侧栏不应使用页面标题");
    }
  }

  go("missing-page");
  expect(document.querySelector("#main-content h1")?.textContent).toBe("页面不存在");
  expect(document.querySelector("#main-content p")?.textContent).toBe("请选择左侧导航继续浏览");
  expect(document.querySelector("#main-content a")?.textContent).toBe("返回工作台");
  expect(document.querySelector("#main-content a")?.getAttribute("href")).toBe("#dashboard");
  expect(document.querySelector(".breadcrumb strong")?.textContent).toBe("工作台");
  expect(document.title).toBe("慧眼智检 · 慧眼智检");
});
