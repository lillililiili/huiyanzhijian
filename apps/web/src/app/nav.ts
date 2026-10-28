export interface NavGroup {
  key: string;
  label: string;
  icon: string;
  items: Array<[string, string]>;
}

export const navGroups: NavGroup[] = [
  {
    key: "detection",
    label: "检测中心",
    icon: "target",
    items: [
      ["detection?metric=dg", "金属屏蔽搭盖率检测"],
      ["detection?metric=jx", "铜丝屏蔽相邻铜丝间隙检测"],
      ["detection?metric=by", "电缆不圆度检测"]
    ]
  },
  {
    key: "data",
    label: "历史与数据追溯",
    icon: "history",
    items: [
      ["history", "历史检测数据"],
      ["trace", "线缆列表与追溯"]
    ]
  },
  {
    key: "reports",
    label: "分析与质量报告",
    icon: "report",
    items: [
      ["analytics", "质量统计分析"],
      ["reports", "质量报告管理"]
    ]
  },
  {
    key: "quality",
    label: "质量配置",
    icon: "shield",
    items: [
      ["metrics", "三项检测指标"],
      ["recipes", "配方与判定规则"],
      ["templates", "报告模板配置"]
    ]
  },
  {
    key: "device",
    label: "设备与接口",
    icon: "connect",
    items: [
      ["devices", "设备档案"],
      ["connections", "数据接入配置"],
      ["mes", "MES接口配置"],
      ["sync", "同步监控"]
    ]
  },
  {
    key: "system",
    label: "系统管理",
    icon: "settings",
    items: [
      ["users", "用户角色与权限"],
      ["audit", "操作审计"],
      ["settings", "系统设置与运行状态"]
    ]
  }
];

export type NavEntry =
  | { type: "link"; route: string; label: string; icon: string }
  | { type: "group"; key: string };

export const navEntries: NavEntry[] = [
  { type: "link", route: "dashboard", label: "工作台", icon: "home" },
  { type: "link", route: "monitor", label: "综合监控", icon: "monitor" },
  { type: "group", key: "detection" },
  { type: "link", route: "workorders", label: "工单管理", icon: "clipboard" },
  { type: "link", route: "tasks", label: "检测任务", icon: "task" },
  { type: "link", route: "specs", label: "产品规格档案", icon: "spec" },
  { type: "group", key: "data" },
  { type: "link", route: "alarms", label: "报警事件", icon: "bell" },
  { type: "group", key: "reports" },
  { type: "group", key: "quality" },
  { type: "group", key: "device" },
  { type: "group", key: "system" }
];

// Business navigation keeps daily work visible; prototype navigation remains unchanged.
export const businessNavEntries: NavEntry[] = navEntries.flatMap(entry =>
  entry.type === 'link' && entry.route === 'workorders'
    ? [entry, {type:'link' as const,route:'trace',label:'线缆管理',icon:'box'}] : [entry]);
export const pendingBusinessRoutes = new Set<string>();
export const reservedBusinessRoutes = new Set(['connections','mes','sync']);

export function groupByKey(key: string) {
  const group = navGroups.find(item => item.key === key);
  if (!group) throw new Error(`未知导航分组 ${key}`);
  return group;
}

export function groupsForRoute(route: string) {
  const opened = new Set(["detection"]);
  for (const group of navGroups) {
    const ownsRoute = group.items.some(([item]) => item.split("?")[0] === route) || (group.key === "reports" && route === "report");
    if (ownsRoute) opened.add(group.key);
  }
  return opened;
}

export function linkActive(itemRoute: string, current: string) {
  return current === itemRoute || (itemRoute === "tasks" && current === "task") || (itemRoute === "alarms" && current === "alarm");
}

export function groupActive(group: NavGroup, current: string) {
  return group.items.some(([item]) => item.split("?")[0] === current) || (group.key === "reports" && current === "report");
}

export function subActive(itemRoute: string, current: string, params: URLSearchParams) {
  const currentFull = current + (current === "detection" ? `?metric=${params.get("metric") || "dg"}` : "");
  return itemRoute === currentFull;
}
