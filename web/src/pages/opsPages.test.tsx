import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetViewState } from "../app/viewState";
import { DENY_ADMIN, DENY_WRITE } from "../auth/permissions";
import { createStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { resetToasts, ToastViewport } from "../ui/Toast";
import { ConnectionsPage } from "./connections/ConnectionsPage";
import { DevicesPage } from "./devices/DevicesPage";
import { MesPage } from "./mes/MesPage";
import { SyncPage } from "./sync/SyncPage";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const quality: SessionUser = { id: "U003", name: "质量审核员", username: "quality", role: "quality" };
const viewer: SessionUser = { id: "U004", name: "只读访客", username: "viewer", role: "viewer" };
const fetchMock = vi.fn(() => Promise.reject(new Error("no network")));

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

function rowOf(id: string) {
  return [...document.querySelectorAll("tbody tr")].find(row => row.textContent?.includes(id));
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetViewState();
  resetToasts();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

test("device cards keep bound metrics read-only and reject duplicate ids", async () => {
  const source = freshStore();
  render(<DevicesPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("设备档案");
  expect(document.querySelectorAll("h1")).toHaveLength(1);
  const dg = panel("金属屏蔽搭盖率检测设备");
  expect(dg?.querySelector("img")?.getAttribute("src")).toBe("assets/images/device-dg.png");
  expect(dg?.querySelector("img")?.getAttribute("alt")).toBe("金属屏蔽搭盖率检测设备设备外观参考");
  expect([...dg!.querySelectorAll("h2")].some(heading => heading.textContent === "HY-DG-01")).toBe(true);
  expect(dg?.textContent).toContain("4 项");
  expect(dg?.textContent).toContain("正在执行 T20261009001");
  expect(document.body.textContent).toContain("正在执行 T20261009002");
  expect(document.body.textContent).toContain("正在执行 T20261009003");
  expect(dg?.querySelector("a")?.getAttribute("href")).toBe("#detection?metric=dg");

  const keyword = document.querySelector<HTMLInputElement>("form.filters input[name='keyword']");
  if (!keyword) throw new Error("缺少关键字");
  keyword.value = "没有这台设备";
  submitFilters();
  expect(document.body.textContent).toContain("没有符合条件的设备");
  keyword.value = "";
  submitFilters();

  await act(async () => { [...panel("金属屏蔽搭盖率检测设备")!.querySelectorAll("button")].find(button => button.textContent?.trim() === "编辑档案")?.click(); });
  expect(document.querySelector("#modal-title")?.textContent).toBe("编辑设备档案");
  expect(document.querySelector("#active-modal-form select[name='metric']")).toBeNull();
  expect(document.querySelector<HTMLInputElement>("#active-modal-form input[type='hidden'][name='metric']")?.value).toBe("dg");
  expect(document.querySelector<HTMLInputElement>("#active-modal-form input[aria-label='检测类型']")?.value).toBe("金属屏蔽搭盖率");
  (field("status") as HTMLSelectElement).value = "offline";
  await submitModal();
  expect(document.body.textContent).toContain("设备档案已保存。");
  expect(source.device("HY-DG-01")?.status).toBe("offline");
  expect(source.device("HY-DG-01")?.metric).toBe("dg");
  expect(source.device("HY-DG-01")?.ip).toBe("192.168.10.101");
  expect(panel("金属屏蔽搭盖率检测设备")?.textContent).toContain("设备离线");
  expect(source.getState().records.filter(record => record.deviceId === "HY-DG-01").every(record => record.metric === "dg")).toBe(true);

  await clickButton("新增设备");
  expect(document.querySelector("#modal-title")?.textContent).toBe("新增检测设备");
  field("id").value = "HY-DG-01";
  field("name").value = "重复设备";
  field("line").value = "新工位";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("设备编号已存在。");
  expect(document.querySelector("#modal-title")).not.toBeNull();
  field("id").value = "HY-DG-02";
  await submitModal();
  expect(source.device("HY-DG-02")?.name).toBe("重复设备");
  expect(source.device("HY-DG-02")?.image).toBe("assets/images/device-dg.png");
  expect(source.getState().devices).toHaveLength(4);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("quality and viewer still see device actions and are refused before the modal", async () => {
  for (const user of [quality, viewer]) {
    render(<DevicesPage store={freshStore(user)} user={user} />);
    expect(buttons("编辑档案")).toHaveLength(3);
    expect(findButton("新增设备")).toBeTruthy();
    await clickButton("新增设备");
    expect(document.body.textContent).toContain(DENY_ADMIN);
    expect(document.querySelector("#modal-title")).toBeNull();
    await clickButton("编辑档案");
    expect(document.querySelector("#modal-title")).toBeNull();
    act(() => { resetToasts(); });
  }
});

test("connection edit is local, and self-check explains the latest stored record", async () => {
  const source = freshStore();
  render(<ConnectionsPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("数据接入配置");
  expect(document.querySelector(".detail-grid code")?.textContent).toBe("http://127.0.0.1:8080/measurements");
  expect(kpi("接入设备")).toBe("3");
  expect(kpi("在线设备")).toBe("3");
  expect(kpi("当前接入模式")).toBe("HTTP");
  expect(document.body.textContent).toContain("不会向配置地址发送网络请求");

  await clickButton("编辑接入配置");
  const longUrl = `http://127.0.0.1:8080/${"segment/".repeat(12)}measurements`;
  field("endpoint").value = longUrl;
  const reconnect = document.querySelector<HTMLInputElement>("#active-modal-form input[name='autoReconnect']");
  if (!reconnect) throw new Error("缺少自动重连");
  reconnect.checked = false;
  await submitModal();
  expect(document.body.textContent).toContain("接入配置已保存。");
  expect(document.querySelector(".detail-grid code")?.textContent).toBe(longUrl);
  expect(source.getState().connections.endpoint).toBe(longUrl);
  expect(source.getState().connections.autoReconnect).toBe(false);
  expect(source.getState().connections.pollInterval).toBe(1000);
  expect(source.getState().connections.mapping.meter).toBe("meter");
  expect(source.getState().connections.dg.host).toBe("192.168.10.101");
  expect(source.getState().connections.jx.host).toBe("192.168.10.102");
  expect(source.getState().connections.by.host).toBe("192.168.10.103");
  expect(document.body.textContent).toContain("已关闭");

  render(<ConnectionsPage store={source} user={viewer} />);
  await clickButton("编辑接入配置");
  expect(document.body.textContent).toContain(DENY_ADMIN);
  expect(document.querySelector("#modal-title")).toBeNull();
  const latest = source.getState().records.filter(record => record.deviceId === "HY-DG-01").at(-1);
  await clickButton("运行接入自检");
  expect(document.querySelector(".drawer h2")?.textContent).toBe("数据接入自检结果");
  expect(document.body.textContent).toContain("此自检未发起外部网络请求");
  expect(document.body.textContent).toContain(latest?.id);
  expect(document.body.textContent).toContain("模拟连接正常");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("MES save requires an http address, keeps the token empty, and checks config locally", async () => {
  const source = freshStore();
  render(<MesPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("MES 接口配置");
  expect(kpi("当前窗口确认比例")).toBe("100%");
  expect(document.body.textContent).toContain("90 / 90 条记录已确认");
  expect(kpi("待同步 / 失败")).toBe("0 / 0");
  expect(kpi("接口模式")).toBe("本地模拟");
  expect(document.body.textContent).toContain("模拟令牌（无真实凭据）");
  expect(document.body.textContent).toContain("逐条记录推送");
  expect(document.querySelector("input[name='token']")).toBeNull();

  await clickButton("编辑 MES 配置");
  expect(document.querySelector("#active-modal-form input[name='token']")).toBeNull();
  expect((field("mode") as HTMLSelectElement).value).toBe("record");
  field("endpoint").value = "ftp://example.com/quality";
  await submitModal();
  expect(document.querySelector(".form-error")?.textContent).toBe("演示地址须为 http 或 https 地址。");
  expect(source.getState().mes.endpoint).toBe("https://mes.example.local/api/inspection");
  expect(source.getState().mes.mode).toBe("simulation");
  field("endpoint").value = "https://mes.example.local/api/quality";
  await submitModal();
  expect(document.body.textContent).toContain("MES 配置已保存。");
  expect(source.getState().mes.endpoint).toBe("https://mes.example.local/api/quality");
  expect(source.getState().mes.url).toBe("https://mes.example.local/api/quality");
  expect(source.getState().mes.mode).toBe("record");
  expect(source.getState().mes.token).toBe("");
  expect(source.getState().mes.enabled).toBe(true);

  await clickButton("编辑 MES 配置");
  const enabled = document.querySelector<HTMLInputElement>("#active-modal-form input[name='enabled']");
  if (!enabled) throw new Error("缺少启用开关");
  enabled.checked = false;
  await submitModal();
  expect(source.getState().mes.enabled).toBe(false);
  expect(source.getState().mes.token).toBe("");
  expect(document.body.textContent).toContain("已停用");

  render(<MesPage store={source} user={viewer} />);
  await clickButton("编辑 MES 配置");
  expect(document.body.textContent).toContain(DENY_ADMIN);
  expect(document.querySelector("#modal-title")).toBeNull();
  await clickButton("检查接口配置");
  expect(document.querySelector(".drawer h2")?.textContent).toBe("MES 配置检查");
  expect(document.body.textContent).toContain("不证明外部 MES 服务可连接");
  expect(document.body.textContent).toContain("暂停推送");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("sync monitor retries only unconfirmed rows and leaves measurements unchanged", async () => {
  const source = freshStore();
  render(<SyncPage store={source} user={admin} />);
  expect(document.querySelector("h1")?.textContent).toBe("MES 同步监控");
  expect(document.body.textContent).not.toContain("数据同步监控");
  expect(source.getState().records).toHaveLength(198);
  expect(kpi("平台接收")).toBe("198");
  expect(kpi("MES 已确认")).toBe("198");
  expect(kpi("待同步")).toBe("0");
  expect(kpi("同步失败")).toBe("0");
  expect(buttons("重试")).toHaveLength(0);
  expect(rowOf("R-T20261009001-30")?.textContent).toContain("已确认");
  expect(rowOf("R-T20261009001-30")?.textContent).toContain("已接收");

  source.saveMes({ endpoint: "https://mes.example.local/api/inspection", mode: "record", timeout: 10000, retries: 3, enabled: false });
  render(<SyncPage store={source} user={admin} />);
  await clickButton("重试筛选内未确认记录");
  expect(document.body.textContent).toContain("MES 同步演示已停用，请先在接口配置中启用。");
  expect(document.body.textContent).not.toContain("MES 接口未启用");
  expect(source.getState().records.every(record => record.mesStatus === "confirmed")).toBe(true);
  act(() => {
    source.saveMes({ endpoint: "https://mes.example.local/api/inspection", mode: "record", timeout: 10000, retries: 3, enabled: true });
    resetToasts();
  });
  await clickButton("重试筛选内未确认记录");
  expect(document.body.textContent).toContain("筛选范围内没有待重试记录。");

  const failedStore = freshStore();
  failedStore.setScenario("mes-failure");
  const target = failedStore.getState().records.filter(record => record.mesStatus === "failed")[0];
  const mark = JSON.stringify({
    value: target.value,
    judgement: target.judgement,
    validity: target.validity,
    rule: target.ruleSnapshot,
    alarms: failedStore.getState().alarms
  });
  render(<SyncPage store={failedStore} user={admin} />);
  expect(rowOf(target.id)?.textContent).toContain("同步失败");
  expect(rowOf(target.id)?.textContent).not.toContain("待处理");
  await act(async () => { rowOf(target.id)?.querySelector("button")?.click(); });
  expect(document.body.textContent).toContain("模拟重试完成：确认 0 条，失败 1 条，待同步 0 条。");
  expect(failedStore.record(target.id)?.mesStatus).toBe("failed");
  expect(failedStore.getState().records).toHaveLength(198);
  expect(JSON.stringify({
    value: failedStore.record(target.id)?.value,
    judgement: failedStore.record(target.id)?.judgement,
    validity: failedStore.record(target.id)?.validity,
    rule: failedStore.record(target.id)?.ruleSnapshot,
    alarms: failedStore.getState().alarms
  })).toBe(mark);

  act(() => {
    resetToasts();
    failedStore.setScenario("normal");
  });
  await act(async () => { rowOf(target.id)?.querySelector("button")?.click(); });
  expect(document.body.textContent).toContain("模拟重试完成：确认 1 条，失败 0 条，待同步 0 条。");
  expect(failedStore.record(target.id)?.mesStatus).toBe("confirmed");
  expect(failedStore.getState().records).toHaveLength(198);
  expect(JSON.stringify({
    value: failedStore.record(target.id)?.value,
    judgement: failedStore.record(target.id)?.judgement,
    validity: failedStore.record(target.id)?.validity,
    rule: failedStore.record(target.id)?.ruleSnapshot,
    alarms: failedStore.getState().alarms
  })).toBe(mark);
  expect(failedStore.retrySync([target.id]).count).toBe(0);
  expect(failedStore.getState().records).toHaveLength(198);

  failedStore.setScenario("mes-failure");
  failedStore.setSession(quality);
  render(<SyncPage store={failedStore} user={quality} />);
  await act(async () => { rowOf(failedStore.getState().records.filter(record => record.mesStatus === "failed")[0].id)?.querySelector("button")?.click(); });
  expect(document.body.textContent).toContain("模拟重试完成：确认 0 条，失败 1 条，待同步 0 条。");
  expect(document.body.textContent).not.toContain(DENY_ADMIN);

  render(<SyncPage store={freshStore(viewer)} user={viewer} />);
  await clickButton("重试筛选内未确认记录");
  expect(document.body.textContent).toContain(DENY_WRITE);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a disabled MES leaves a new sample pending instead of marking it handled", async () => {
  const source = freshStore();
  source.saveMes({ endpoint: "https://mes.example.local/api/inspection", mode: "record", timeout: 10000, retries: 3, enabled: false });
  const created = source.advanceTask("T20261009001");
  render(<SyncPage store={source} user={admin} />);
  const badges = [...(rowOf(created.id)?.querySelectorAll(".badge") || [])].map(badge => badge.textContent);
  expect(badges).toContain("待同步");
  expect(badges).toContain("已接收");
  expect(badges).not.toContain("待处理");
  expect(source.getState().records).toHaveLength(199);
});
