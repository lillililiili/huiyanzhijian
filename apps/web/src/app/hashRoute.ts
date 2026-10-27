import { isMetricId, METRICS } from "../domain/metrics";

export interface ParsedHash {
  route: string;
  params: URLSearchParams;
  raw: string;
}

export const routeTitles: Record<string, string> = {
  login: "登录",
  dashboard: "工作台首页",
  monitor: "产线与设备实时总览",
  detection: "检测中心",
  workorders: "工单管理",
  tasks: "检测任务列表",
  task: "检测任务详情",
  specs: "高压电缆产品规格档案",
  history: "历史检测数据查询",
  trace: "线缆列表与追溯",
  import: "数据导入与补录",
  alarms: "报警事件",
  alarm: "报警详情与处置",
  analytics: "质量统计分析",
  reports: "质量报告管理",
  report: "报告预览与导出",
  metrics: "三项检测指标",
  recipes: "配方与判定规则",
  templates: "报告模板配置",
  devices: "设备档案",
  connections: "数据接入配置",
  mes: "MES接口配置",
  sync: "同步监控",
  users: "用户角色与权限",
  audit: "操作审计",
  settings: "系统设置与运行状态"
};

export const pageHeadings: Record<string, string> = {
  ...routeTitles,
  mes: "MES 接口配置",
  sync: "MES 同步监控"
};

export const knownRoutes = new Set(Object.keys(routeTitles));

let returnRoute = "dashboard";
let pendingLoginRoute = "";

export function rememberReturnRoute(raw: string) {
  returnRoute = raw || "dashboard";
}

export function currentReturnRoute() {
  return returnRoute || "dashboard";
}

export function resetReturnRoute(route = "dashboard") {
  returnRoute = route;
  pendingLoginRoute = "";
}

export function queueReturnAfterLogin() {
  pendingLoginRoute = currentReturnRoute();
}

export function consumePendingLoginRoute() {
  const route = pendingLoginRoute || "dashboard";
  pendingLoginRoute = "";
  return route;
}

export function parseHash(hash: string): ParsedHash {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  const source = body || "login";
  const queryAt = source.indexOf("?");
  const route = (queryAt === -1 ? source : source.slice(0, queryAt)) || "login";
  const params = new URLSearchParams(queryAt === -1 ? "" : source.slice(queryAt + 1));
  return { route, params, raw: source };
}

export function breadcrumbTitle(route: string, params: URLSearchParams) {
  if(route==="workorders"&&params.get("id"))return "工单详情";
  if(route==="tasks"&&params.get("view")==="plans")return params.get("plan")?"批量计划详情":"批量计划";
  if(route==="tasks"&&params.get("view")==="auto")return "自动发现配置";
  if (route === "detection") {
    const key = params.get("metric") || "dg";
    const name = isMetricId(key) ? METRICS[key].name : undefined;
    return `${name}检测`;
  }
  return routeTitles[route] || "工作台";
}

export function detectionHeading(metric: string | null) {
  if (metric === "jx") return "铜丝屏蔽相邻铜丝间隙检测";
  if (metric === "by") return "电缆不圆度检测";
  return "金属屏蔽搭盖率检测";
}

export function documentTitle(route: string) {
  return `${routeTitles[route] || "慧眼智检"} · 慧眼智检`;
}

export function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

export function currentHash() {
  return window.location.hash;
}

export function navigate(route: string) {
  const next = route.replace(/^#/, "");
  if (window.location.hash.slice(1) !== next) window.location.hash = next;
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
