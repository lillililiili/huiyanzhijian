import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { knownRoutes } from "../app/hashRoute";
import { createStore, type InspectionStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { DENY_ADMIN, DENY_RECORD_RETRY, DENY_WRITE, DENY_WRITE_CORE, canWrite, isAdmin, roleBadge } from "./permissions";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const quality: SessionUser = { id: "U003", name: "质量审核员", username: "quality", role: "quality" };
const viewer: SessionUser = { id: "U004", name: "访客", username: "viewer", role: "viewer" };

const routeNames = [
  "login", "dashboard", "monitor", "detection", "tasks", "task", "specs", "history", "trace",
  "alarms", "alarm", "analytics", "reports", "report", "metrics", "recipes", "templates",
  "devices", "connections", "mes", "sync", "users", "audit", "settings"
];

function open(user: SessionUser) {
  const store = createStore({ persistence: memoryPersistence() });
  store.setSession(user);
  return store;
}

function rejection(run: () => void) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error.message;
  }
  return "";
}

function coreCalls(store: InspectionStore) {
  return [
    () => store.createTask({} as never),
    () => store.startTask("missing"),
    () => store.advanceTask("missing"),
    () => store.completeTask("missing"),
    () => store.createReport("missing"),
    () => store.importRecords({} as never),
    () => store.saveSpec({})
  ];
}

function writeCalls(store: InspectionStore) {
  return [
    () => store.updateAlarm("missing", { status: "processing", note: "说明" }),
    () => store.reviseRecipe("missing", { threshold: 11 }),
    () => store.saveMetricDisplay("dg", { decimals: 9, description: "说明" }),
    () => store.saveTemplate({}),
    () => store.retrySync("bad" as never)
  ];
}

function adminCalls(store: InspectionStore) {
  return [
    () => store.saveDevice({}),
    () => store.saveConnections({}),
    () => store.saveMes({}),
    () => store.saveUser({}),
    () => store.saveSettings({}),
    () => store.setScenario("not-a-scene"),
    () => store.reset()
  ];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

test("permission copy keeps four distinct sentences and the drawer role names", () => {
  assert.equal(DENY_WRITE_CORE, "当前为只读角色，请切换质量管理员或检测操作员后操作");
  assert.equal(DENY_WRITE, "当前角色为只读，不能修改演示数据。");
  assert.equal(DENY_ADMIN, "此操作需要系统管理员角色，请切换演示身份。");
  assert.equal(DENY_RECORD_RETRY, "当前角色为只读");
  assert.equal(new Set([DENY_WRITE_CORE, DENY_WRITE, DENY_ADMIN, DENY_RECORD_RETRY]).size, 4);
  assert.equal(canWrite(admin), true);
  assert.equal(canWrite(quality), true);
  assert.equal(canWrite(viewer), false);
  assert.equal(canWrite(null), false);
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(quality), false);
  assert.equal(isAdmin(viewer), false);
  assert.equal(isAdmin(null), false);
  assert.deepEqual(roleBadge("admin"), ["系统管理员", "blue"]);
  assert.deepEqual(roleBadge("quality"), ["质量管理员", "green"]);
  assert.deepEqual(roleBadge("viewer"), ["只读查看者", "gray"]);
  assert.equal(routeNames.length, 24);
  assert.equal(knownRoutes.size, routeNames.length + 1);
  assert.equal(knownRoutes.has("workorders"), true);
  for (const route of routeNames) assert.equal(knownRoutes.has(route), true);
});

test("store denies viewer and non-admin commands with the matrix sentences", () => {
  const viewerStore = open(viewer);
  const recordsBefore = viewerStore.getState().records.length;
  for (const run of coreCalls(viewerStore)) assert.equal(rejection(run), DENY_WRITE_CORE);
  for (const run of writeCalls(viewerStore)) assert.equal(rejection(run), DENY_WRITE);
  for (const run of adminCalls(viewerStore)) assert.equal(rejection(run), DENY_ADMIN);
  assert.equal(rejection(() => viewerStore.advanceTask("T20261009001")), DENY_WRITE_CORE);
  assert.equal(viewerStore.getState().records.length, recordsBefore);
  assert.equal(rejection(() => viewerStore.retrySync()), DENY_WRITE);
  assert.notEqual(DENY_RECORD_RETRY, DENY_WRITE);
  assert.equal(viewerStore.device("HY-DG-01")?.status, "online");
  assert.equal(viewerStore.getState().settings.scenario, "normal");
  assert.equal(viewerStore.getState().users.length, 4);

  const qualityStore = open(quality);
  for (const run of coreCalls(qualityStore)) {
    const message = rejection(run);
    assert.notEqual(message, DENY_WRITE_CORE);
    assert.notEqual(message, DENY_ADMIN);
  }
  for (const run of writeCalls(qualityStore)) {
    const message = rejection(run);
    assert.notEqual(message, DENY_WRITE);
    assert.notEqual(message, DENY_ADMIN);
  }
  for (const run of adminCalls(qualityStore)) assert.equal(rejection(run), DENY_ADMIN);
  assert.equal(qualityStore.getState().settings.scenario, "normal");
  assert.equal(qualityStore.device("HY-DG-01")?.status, "online");
  const reviewed = qualityStore.updateAlarm("AL20261009001", { status: "processing", note: "质量复核" });
  assert.equal(reviewed.status, "processing");
  assert.equal(reviewed.note, "质量复核");
  assert.equal(qualityStore.alarm("AL20261009001")?.history.at(-1)?.note, "质量复核");

  const adminStore = open(admin);
  for (const run of [...coreCalls(adminStore), ...writeCalls(adminStore), ...adminCalls(adminStore)]) {
    const message = rejection(run);
    assert.notEqual(message, DENY_WRITE_CORE);
    assert.notEqual(message, DENY_WRITE);
    assert.notEqual(message, DENY_ADMIN);
  }
  adminStore.setScenario("offline");
  assert.equal(adminStore.device("HY-DG-01")?.status, "offline");
  adminStore.setSession(viewer);
  assert.equal(rejection(() => adminStore.reset()), DENY_ADMIN);
  assert.equal(adminStore.getState().settings.scenario, "offline");
  adminStore.setSession(admin);
  adminStore.reset();
  assert.equal(adminStore.getState().settings.scenario, "normal");
  assert.equal(adminStore.device("HY-DG-01")?.status, "online");
  assert.equal(adminStore.getState().tasks.length, 12);
});

test("application source does not inject HTML", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const forbidden = ["dangerouslySetInnerHTML", ".innerHTML", "insertAdjacentHTML"];
  const hits = sourceFiles(root).flatMap(file => {
    const text = readFileSync(file, "utf8");
    return forbidden.filter(token => text.includes(token)).map(token => `${path.relative(root, file)}:${token}`);
  });
  assert.deepEqual(hits, []);
});
