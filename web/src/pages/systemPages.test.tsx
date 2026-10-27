import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { resetViewState } from "../app/viewState";
import { DENY_ADMIN } from "../auth/permissions";
import { getSession, setSessionUser } from "../auth/session";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { LoginPage } from "../app/shell/LoginPage";
import { AuditPage } from "./audit/AuditPage";
import { SettingsPage } from "./settings/SettingsPage";
import { SyncPage } from "./sync/SyncPage";
import { TasksPage } from "./tasks/TasksPage";
import { UsersPage } from "./users/UsersPage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const quality: SessionUser = { id: "U003", name: "质量审核员", username: "quality", role: "quality" };
const viewer: SessionUser = { id: "U004", name: "访客", username: "viewer", role: "viewer" };

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

function kpiNote(label: string) {
  const node = [...document.querySelectorAll(".kpi-label")].find(item => item.textContent === label);
  return node?.parentElement?.querySelector(".kpi-note")?.textContent || "";
}

function check(label: string) {
  const row = [...document.querySelectorAll(".stack .row")].find(item => item.querySelector("span")?.textContent === label);
  return row?.querySelector("strong")?.textContent || "";
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

function filterField(name: string) {
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`form.filters [name='${name}']`);
  if (!node) throw new Error(`缺少 ${name}`);
  return node;
}

function rowButton(text: string, label: string) {
  const row = [...document.querySelectorAll("tbody tr")].find(item => item.textContent?.includes(text));
  if (!row) throw new Error(`缺少 ${text}`);
  const button = [...row.querySelectorAll("button")].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`缺少 ${label}`);
  return button;
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function captureDownloads() {
  const captured: { name: string; type: string; bytes: Promise<ArrayBuffer> }[] = [];
  let lastBlob: Blob | null = null;
  if (typeof URL.createObjectURL !== "function") URL.createObjectURL = () => "";
  if (typeof URL.revokeObjectURL !== "function") URL.revokeObjectURL = () => {};
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    if (value instanceof Blob) lastBlob = value;
    return "blob:mock";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (lastBlob && this.download) captured.push({ name: this.download, type: lastBlob.type, bytes: lastBlob.arrayBuffer() });
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
  setSessionUser(null);
  vi.restoreAllMocks();
  window.location.hash = "";
});

test("users page uses role names and refuses quality and viewer before the modal", async () => {
  const source = freshStore();
  render(<UsersPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("用户角色与权限");
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(panel("只读观察员")?.querySelector("strong")?.textContent).toBe("1");
  expect(panel("只读观察员")?.textContent).toContain("名用户");
  expect(panel("系统管理员")?.querySelector("strong")?.textContent).toBe("1");
  expect(panel("质量管理员")?.querySelector("strong")?.textContent).toBe("2");
  expect(document.querySelector("tbody")?.textContent).toContain("访客");
  expect(document.querySelector("tbody")?.textContent).toContain("只读观察员");
  expect(document.body.textContent).not.toContain("只读查看者");
  expect(document.querySelector("input[name='password']")).toBeNull();
  expect(document.querySelector("input[name='token']")).toBeNull();

  filterField("keyword").value = "访客";
  submitFilters();
  expect(document.querySelector("tbody")?.textContent).toContain("访客");
  expect(document.querySelector("tbody")?.textContent).not.toContain("检测操作员");
  await clickButton("重置");

  for (const user of [quality, viewer]) {
    render(<UsersPage store={freshStore(user)} user={user} />);
    expect(buttons("新增用户")).toHaveLength(1);
    expect(buttons("编辑用户")).toHaveLength(4);
    expect(document.body.textContent).not.toContain("只读查看者");
    await clickButton("新增用户");
    expect(document.body.textContent).toContain(DENY_ADMIN);
    expect(document.querySelector("#modal-title")).toBeNull();
    await clickButton("编辑用户");
    expect(document.querySelector("#modal-title")).toBeNull();
    act(() => { resetToasts(); });
  }
});

test("user edits keep the last admin, block self-disable, and a disabled account cannot log in", async () => {
  const source = freshStore();
  render(<UsersPage store={source} user={admin} />);
  await clickButton("新增用户");
  expect(document.querySelector("#modal-title")?.textContent).toBe("新增演示用户");
  expect(document.querySelector("input[name='password']")).toBeNull();
  expect(document.querySelector("input[name='token']")).toBeNull();
  expect(document.body.textContent).toContain("不设置或存储真实用户密码");
  field("name").value = "重复账号";
  field("account").value = "admin";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("该账号已经存在。");
  expect(document.querySelector("#modal-title")).not.toBeNull();
  field("name").value = "巡检员";
  field("account").value = "inspector01";
  await submitModal();
  expect(document.body.textContent).toContain("用户配置已保存。");
  const created = source.getState().users.find(item => item.account === "inspector01");
  expect(created?.username).toBe("inspector01");
  expect(created?.department).toBe("");
  expect(created?.lastLogin).toBeNull();
  expect(Object.hasOwn(created ?? {}, "password")).toBe(false);
  expect(document.body.textContent).toContain("巡检员");

  await act(async () => { rowButton("质量管理员", "编辑用户").click(); });
  expect(document.querySelector("#modal-title")?.textContent).toBe("编辑演示用户");
  (field("enabled") as HTMLSelectElement).value = "false";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("至少保留一位启用的系统管理员。");
  expect(source.getState().users.find(item => item.id === "U001")).toMatchObject({ role: "admin", enabled: true });

  await act(async () => { findButton("取消")?.click(); });
  await clickButton("新增用户");
  field("name").value = "备份管理员";
  field("account").value = "backup01";
  (field("role") as HTMLSelectElement).value = "admin";
  await submitModal();
  expect(source.getState().users.filter(item => item.role === "admin" && item.enabled !== false)).toHaveLength(2);

  await act(async () => { rowButton("质量管理员", "编辑用户").click(); });
  (field("enabled") as HTMLSelectElement).value = "false";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("当前会话用户不能停用自己。");
  expect(source.getState().users.find(item => item.id === "U001")?.enabled).toBe(true);
  field("name").value = "现场管理员";
  field("account").value = "admin01";
  (field("enabled") as HTMLSelectElement).value = "true";
  (field("role") as HTMLSelectElement).value = "admin";
  await submitModal();
  expect(getSession()).toEqual({ id: "U001", name: "现场管理员", username: "admin", role: "admin" });
  expect(source.getState().users.find(item => item.id === "U001")?.username).toBe("admin01");
  expect(source.getState().audits.at(-1)?.actor).toBe("现场管理员");
  expect(source.getState().audits.at(-1)?.role).toBe("admin");
  expect(source.getState().audits.at(-1)?.action).toBe("修改用户与角色");

  await act(async () => { rowButton("检测操作员", "编辑用户").click(); });
  (field("enabled") as HTMLSelectElement).value = "false";
  await submitModal();
  expect(source.getState().users.find(item => item.id === "U002")?.enabled).toBe(false);
  expect(source.getState().users.find(item => item.id === "U002")?.username).toBe("operator");

  act(() => { setSessionUser(null); });
  render(<LoginPage store={source} users={source.getState().users} />);
  const account = document.querySelector<HTMLInputElement>("#login-account");
  const password = document.querySelector<HTMLInputElement>("#login-password");
  if (!account || !password) throw new Error("缺少登录输入");
  setValue(account, "operator");
  setValue(password, "demo1234");
  await act(async () => { document.querySelector<HTMLButtonElement>(".login-submit")?.click(); });
  expect(document.querySelector(".login-form .form-error")?.textContent).toBe("账号不存在或已停用，请选择演示身份。");
  expect(getSession()).toBeNull();
});

test("audit page shows local times, filters the export, and pages ten rows before a page size is saved", async () => {
  const source = createStore({ persistence: memoryPersistence(), now: () => "2026-10-16T08:09:10.123Z" });
  source.setSession(admin);
  source.log("公式探针", "=1+1");
  const downloads = captureDownloads();
  render(<AuditPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("操作审计");
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(document.body.textContent).toContain("2026-10-09 08:00:00");
  expect(document.body.textContent).toContain("2026-10-16 08:09:10");
  expect(document.body.textContent).not.toContain(".123");
  expect(document.body.textContent).toContain("10 条 / 页");
  expect(document.body.textContent).toContain("查询结果 7 条");
  expect(document.body.textContent).toContain("审计记录保存在当前浏览器");

  filterField("keyword").value = "公式探针";
  submitFilters();
  expect(document.body.textContent).toContain("查询结果 1 条");
  const beforeExport = source.getState().audits.length;
  await clickButton("导出审计记录");
  expect(source.getState().audits.length).toBe(beforeExport);
  expect(downloads).toHaveLength(1);
  expect(downloads[0].name).toBe("慧眼智检-操作审计.csv");
  expect(downloads[0].type).toBe("text/csv;charset=utf-8");
  const filtered = csvText(await downloads[0].bytes);
  expect(filtered).toContain("\r\n");
  expect(filtered).toContain(`"'=1+1"`);
  expect(filtered).toContain("公式探针");
  expect(filtered).not.toContain("登录系统");
  expect(filtered.split("\r\n")).toHaveLength(2);

  await clickButton("重置");
  filterField("from").value = "2026-10-09";
  filterField("to").value = "2026-10-09";
  submitFilters();
  expect(document.body.textContent).toContain("查询结果 6 条");
  expect(document.body.textContent).not.toContain("2026-10-16 08:09:10");
  filterField("from").value = "2026-10-16";
  filterField("to").value = "2026-10-16";
  submitFilters();
  expect(document.body.textContent).toContain("查询结果 1 条");
  expect(document.body.textContent).toContain("2026-10-16 08:09:10");

  await clickButton("重置");
  render(<AuditPage store={source} user={viewer} />);
  expect(findButton("导出审计记录")).toBeTruthy();
  const beforeViewer = source.getState().audits.length;
  await clickButton("导出审计记录");
  expect(source.getState().audits.length).toBe(beforeViewer);
  expect(document.body.textContent).not.toContain(DENY_ADMIN);
  expect(downloads[1].name).toBe("慧眼智检-操作审计.csv");
  const full = csvText(await downloads[1].bytes);
  expect(full).toContain("登录系统");
  expect(full).toContain(`"'=1+1"`);
  expect(full.split("\r\n").length).toBeGreaterThan(2);
});

test("settings keeps the frozen runtime KPI and follows the real storage mode", () => {
  render(<SettingsPage store={freshStore()} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("系统设置与运行状态");
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  expect(kpi("运行环境")).toBe("本地原型");
  expect(kpiNote("运行环境")).toBe("HTML · CSS · JavaScript");
  expect(document.body.textContent).not.toContain("Vite");
  expect(document.body.textContent).not.toContain("React");
  expect(document.body.textContent).not.toContain("TypeScript");
  expect(kpi("当前场景")).toBe("正常演示");
  expect(kpi("数据有效性")).toBe("0 条无效");
  expect(kpiNote("数据有效性")).toBe("198 条有效记录");
  expect(kpi("存储方式")).toBe("浏览器本地");
  expect(kpiNote("存储方式")).toBe("刷新后保留演示修改");
  expect(check("本地数据仓库")).toBe("可用");
  expect(check("登记检测设备")).toBe("3 台");
  expect(check("在线设备")).toBe("3 台");
  expect(check("MES 未确认记录")).toBe("0 条");
  expect(check("未完成复核事件")).toBe("1 条");
  expect(document.body.textContent).toContain("5 秒");
  expect(document.body.textContent).toContain("8 条 / 页");

  const blocked = createStore({ persistence: memoryPersistence(new Map(), true) });
  expect(blocked.memoryOnly).toBe(true);
  render(<SettingsPage store={blocked} user={admin} />);
  expect(kpi("存储方式")).toBe("内存模式");
  expect(kpiNote("存储方式")).toBe("当前浏览器存储不可用，关闭后不保留");
  expect(kpi("运行环境")).toBe("本地原型");

  const probe = createStore({ persistence: memoryPersistence() });
  const corruptItems = new Map<string, string>([[probe.key, "{broken"]]);
  const corrupt = createStore({ persistence: memoryPersistence(corruptItems) });
  expect(corrupt.memoryOnly).toBe(true);
  render(<SettingsPage store={corrupt} user={admin} />);
  expect(kpi("存储方式")).toBe("内存模式");
  expect(corruptItems.get(probe.key)).toBe("{broken");

  const stale = JSON.stringify({ schemaVersion: 999 });
  const staleItems = new Map<string, string>([[probe.key, stale]]);
  const incompatible = createStore({ persistence: memoryPersistence(staleItems) });
  expect(incompatible.memoryOnly).toBe(false);
  render(<SettingsPage store={incompatible} user={admin} />);
  expect(kpi("存储方式")).toBe("浏览器本地");
  expect(kpiNote("存储方式")).toBe("刷新后保留演示修改");
  expect(staleItems.get(probe.key)).toBe(stale);
});

test("system settings save the page size used by audit, sync and tasks", async () => {
  const source = freshStore();
  render(<TasksPage store={source} user={admin} />);
  expect(document.body.textContent).toContain("8 条 / 页");
  render(<SettingsPage store={source} user={admin} />);
  await clickButton("编辑系统设置");
  expect(document.querySelector("#modal-title")?.textContent).toBe("编辑系统设置");
  field("platformName").value = "验收平台";
  field("organization").value = "沉积岩实验室";
  (field("refreshInterval") as HTMLSelectElement).value = "10";
  (field("pageSize") as HTMLSelectElement).value = "20";
  await submitModal();
  expect(document.body.textContent).toContain("系统设置已保存。");
  const settings = source.getState().settings;
  expect(settings.platformName).toBe("验收平台");
  expect(settings.organization).toBe("沉积岩实验室");
  expect(settings.company).toBe(settings.organization);
  expect(settings.refreshInterval).toBe(10);
  expect(settings.pageSize).toBe(20);
  expect(settings.demoTime).toBe("2026-10-09 14:30:00");
  expect(settings.scenario).toBe("normal");
  expect(document.body.textContent).toContain("验收平台");
  expect(document.body.textContent).toContain("20 条 / 页");

  render(<AuditPage store={source} user={admin} />);
  expect(document.body.textContent).toContain("20 条 / 页");
  expect(document.body.textContent).not.toContain("10 条 / 页");
  render(<SyncPage store={source} user={viewer} />);
  expect(document.body.textContent).toContain("20 条 / 页");
  render(<TasksPage store={source} user={quality} />);
  expect(document.body.textContent).toContain("20 条 / 页");
  expect(document.body.textContent).not.toContain("8 条 / 页");
});

test("scenario and reset stay admin-only, and offline changes only the overlap device", async () => {
  for (const user of [quality, viewer]) {
    const source = freshStore(user);
    render(<SettingsPage store={source} user={user} />);
    expect(findButton("编辑系统设置")).toBeTruthy();
    expect(buttons("切换场景")).toHaveLength(3);
    expect(findButton("恢复初始数据")).toBeTruthy();
    await clickButton("编辑系统设置");
    expect(document.body.textContent).toContain(DENY_ADMIN);
    expect(document.querySelector("#modal-title")).toBeNull();
    await clickButton("切换场景");
    expect(document.querySelector("#modal-title")).toBeNull();
    await clickButton("恢复初始数据");
    expect(document.querySelector("#modal-title")).toBeNull();
    expect(source.getState().settings.scenario).toBe("normal");
    expect(source.getState().devices.every(device => device.status === "online")).toBe(true);
    act(() => { resetToasts(); });
  }

  const source = freshStore();
  render(<SettingsPage store={source} user={admin} />);
  const offline = [...document.querySelectorAll("h3")].find(item => item.textContent === "设备离线")?.parentElement?.querySelector("button");
  if (!offline) throw new Error("缺少设备离线");
  await act(async () => { offline.click(); });
  expect(document.body.textContent).toContain("已应用演示场景，可查看监控、历史数据及同步状态。");
  expect(source.getState().settings.scenario).toBe("offline");
  expect(source.device("HY-DG-01")?.status).toBe("offline");
  expect(source.device("HY-JX-01")?.status).toBe("online");
  expect(source.device("HY-BY-01")?.status).toBe("online");
  expect(kpi("当前场景")).toBe("设备离线");
  expect(check("在线设备")).toBe("2 台");
});

test("reset requires confirmation, restores the seed, and keeps the session", async () => {
  const source = freshStore();
  const kept: SessionUser = { id: "U001", name: "会话保留", username: "admin", role: "admin" };
  source.setSession(kept);
  act(() => { setSessionUser(kept); });
  source.saveSettings({ platformName: "临时平台", organization: "临时机构", refreshInterval: 10, pageSize: 20 });
  source.saveUser({ name: "临时用户", account: "temp01", role: "viewer", enabled: true });
  expect(source.getState().users).toHaveLength(5);
  render(<SettingsPage store={source} user={kept} />);
  await clickButton("恢复初始数据");
  expect(document.querySelector("#modal-title")?.textContent).toBe("恢复初始演示数据");
  expect(document.body.textContent).toContain("当前浏览器中新建的任务、导入的数据、报警处置、报告与配置修改将被清除。项目源码和图片素材保留。");
  expect(document.body.textContent).toContain("恢复后可以重新从初始场景演示全部流程。");
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("请勾选确认后再恢复。");
  expect(document.querySelector("#modal-title")).not.toBeNull();
  expect(source.getState().users).toHaveLength(5);
  expect(source.getState().settings.platformName).toBe("临时平台");
  expect(window.location.hash).not.toBe("#dashboard");

  const confirm = document.querySelector<HTMLInputElement>("#active-modal-form input[name='confirmReset']");
  if (!confirm) throw new Error("缺少确认");
  confirm.checked = true;
  await submitModal();
  expect(document.body.textContent).toContain("已恢复初始演示数据。");
  expect(document.querySelector("#modal-title")).toBeNull();
  expect(source.getState().users).toHaveLength(4);
  expect(source.getState().users.some(item => item.username === "temp01")).toBe(false);
  expect(source.getState().tasks).toHaveLength(12);
  expect(source.getState().devices).toHaveLength(3);
  expect(source.getState().settings.platformName).toBe("线缆质量管控平台");
  expect(source.getState().settings.pageSize).toBeUndefined();
  expect(window.location.hash).toBe("#dashboard");
  expect(getSession()).toEqual(kept);
  source.log("会话探针", "恢复后仍是原会话");
  expect(source.getState().audits.at(-1)?.actor).toBe("会话保留");
  expect(source.getState().audits.at(-1)?.role).toBe("admin");
});
