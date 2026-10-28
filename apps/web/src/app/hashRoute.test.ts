import { beforeEach, expect, test } from "vitest";
import { canWrite, DENY_ADMIN, DENY_RECORD_RETRY, DENY_WRITE, DENY_WRITE_CORE, isAdmin, roleBadge } from "../auth/permissions";
import type { SessionUser } from "../domain/types";
import { breadcrumbTitle, consumePendingLoginRoute, currentReturnRoute, detectionHeading, documentTitle, knownRoutes, pageHeadings, parseHash, queueReturnAfterLogin, rememberReturnRoute, resetReturnRoute, routeTitles } from "./hashRoute";
import { groupActive, groupByKey, groupsForRoute, linkActive, subActive } from "./nav";

const admin: SessionUser = { id: "U001", name: "质量管理员", username: "admin", role: "admin" };
const operator: SessionUser = { id: "U002", name: "检测操作员", username: "operator", role: "quality" };
const viewer: SessionUser = { id: "U004", name: "访客", username: "viewer", role: "viewer" };

const routeNames = [
  "login", "dashboard", "monitor", "detection", "tasks", "task", "specs", "history", "trace",
  "alarms", "alarm", "analytics", "reports", "report", "metrics", "recipes", "templates", "devices",
  "connections", "mes", "sync", "users", "audit", "settings"
];

beforeEach(() => {
  resetReturnRoute();
});

test("hash parsing keeps the query and treats an empty hash as login", () => {
  expect(parseHash("")).toMatchObject({ route: "login", raw: "login" });
  expect(parseHash("#")).toMatchObject({ route: "login", raw: "login" });
  const detection = parseHash("#detection?metric=foo&task=T20261009001");
  expect(detection.route).toBe("detection");
  expect(detection.raw).toBe("detection?metric=foo&task=T20261009001");
  expect(detection.params.get("metric")).toBe("foo");
  expect(detection.params.get("task")).toBe("T20261009001");
  expect([...knownRoutes].sort()).toEqual([...routeNames,"workorders"].sort());
  expect(knownRoutes.has("about")).toBe(false);
});

test("breadcrumbs, headings and document titles stay on three different string sets", () => {
  const foo = parseHash("#detection?metric=foo");
  expect(breadcrumbTitle(foo.route, foo.params)).toBe("undefined检测");
  expect(detectionHeading(foo.params.get("metric"))).toBe("金属屏蔽搭盖率检测");
  expect(documentTitle(foo.route)).toBe("检测中心 · 慧眼智检");

  const plain = parseHash("#detection");
  expect(breadcrumbTitle(plain.route, plain.params)).toBe("金属屏蔽搭盖率检测");
  expect(detectionHeading("jx")).toBe("铜丝屏蔽相邻铜丝间隙检测");
  expect(detectionHeading("by")).toBe("电缆不圆度检测");
  expect(detectionHeading(null)).toBe("金属屏蔽搭盖率检测");

  expect(routeTitles.mes).toBe("MES接口配置");
  expect(pageHeadings.mes).toBe("MES 接口配置");
  expect(routeTitles.sync).toBe("同步监控");
  expect(pageHeadings.sync).toBe("MES 同步监控");
  expect(breadcrumbTitle("mes", new URLSearchParams())).toBe("MES接口配置");
  expect(breadcrumbTitle("missing", new URLSearchParams())).toBe("工作台");
  expect(documentTitle("missing")).toBe("慧眼智检 · 慧眼智检");
  expect(documentTitle("dashboard")).toBe("工作台首页 · 慧眼智检");
});

test("navigation highlights detail routes and keeps detection open", () => {
  expect(linkActive("tasks", "task")).toBe(true);
  expect(linkActive("tasks", "tasks")).toBe(true);
  expect(linkActive("alarms", "alarm")).toBe(true);
  expect(linkActive("reports", "report")).toBe(false);
  expect(linkActive("dashboard", "monitor")).toBe(false);

  const reportGroups = groupsForRoute("report");
  expect(reportGroups.has("detection")).toBe(true);
  expect(reportGroups.has("reports")).toBe(true);
  expect(groupsForRoute("metrics").has("quality")).toBe(true);
  expect([...groupsForRoute("task")]).toEqual(["detection"]);
  expect(groupsForRoute("sync").has("device")).toBe(true);
  expect(groupActive(groupByKey("reports"), "report")).toBe(true);
  expect(groupActive(groupByKey("quality"), "metrics")).toBe(true);
  expect(() => groupByKey("missing")).toThrow("未知导航分组 missing");

  const gap = new URLSearchParams("metric=jx");
  expect(subActive("detection?metric=jx", "detection", gap)).toBe(true);
  expect(subActive("detection?metric=dg", "detection", gap)).toBe(false);
  expect(subActive("detection?metric=dg", "detection", new URLSearchParams())).toBe(true);
  expect(subActive("history", "history", new URLSearchParams())).toBe(true);
});

test("login consumes the saved return route once", () => {
  rememberReturnRoute("monitor?view=1");
  expect(currentReturnRoute()).toBe("monitor?view=1");
  queueReturnAfterLogin();
  expect(consumePendingLoginRoute()).toBe("monitor?view=1");
  expect(consumePendingLoginRoute()).toBe("dashboard");
  rememberReturnRoute("");
  expect(currentReturnRoute()).toBe("dashboard");
});

test("write and admin permissions follow the signed-in role", () => {
  expect(canWrite(null)).toBe(false);
  expect(canWrite(viewer)).toBe(false);
  expect(canWrite(operator)).toBe(true);
  expect(canWrite(admin)).toBe(true);
  expect(isAdmin(admin)).toBe(true);
  expect(isAdmin(operator)).toBe(false);
  expect(isAdmin(viewer)).toBe(false);
  expect(roleBadge("admin")).toEqual(["系统管理员", "blue"]);
  expect(roleBadge("quality")).toEqual(["质量管理员", "green"]);
  expect(roleBadge("viewer")).toEqual(["只读查看者", "gray"]);
  expect(roleBadge("other")).toEqual(["other", "gray"]);
  expect(DENY_WRITE_CORE).toBe("当前为只读角色，请切换质量管理员或检测操作员后操作");
  expect(DENY_WRITE).toBe("当前角色为只读，不能修改演示数据。");
  expect(DENY_ADMIN).toBe("此操作需要系统管理员角色，请切换演示身份。");
  expect(DENY_RECORD_RETRY).toBe("当前角色为只读");
});
