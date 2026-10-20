import { judge } from "./judge";
import { METRICS } from "./metrics";
import { stats } from "./stats";
import { clone, pad, round, timeAdd } from "./time";
import type { AppState, MetricId, RecordAux } from "./types";

function aux(metric: MetricId, value: number | null, sample: number): RecordAux {
  if (value === null) return {};
  if (metric === "dg") return { overlapWidth: round(value / 100 * 30), tapeWidth: 30, pitch: round(30 - value / 100 * 30), description: "演示量测：搭盖宽度与节距为辅助量，不替代设备输出的搭盖率" };
  if (metric === "jx") return { localGaps: [round(value - .14), round(value + .03), round(value + .08), round(value + .03)], meanGap: value, description: "四处局部间隙的平均值作为当前平均间隙演示" };
  return { xDiameter: round(66.42 + ((sample + 1) % 3) * .01), yDiameter: 63.52, description: "X / Y 外径为辅助数据；不圆度取设备输出，计算口径另行确认，不代表全周重建" };
}

function snapshot(recipe: AppState["recipes"][number]) {
  return { id: recipe.id, version: recipe.version, threshold: recipe.threshold, operator: recipe.operator };
}

export function seed(): AppState {
  const state: AppState = { schemaVersion: 1, tasks: [], specs: [], devices: [], records: [], alarms: [], recipes: [], reports: [], audits: [], users: [], settings: {} as AppState["settings"], mes: {} as AppState["mes"], connections: {} as AppState["connections"], reportTemplate: {} as AppState["reportTemplate"] };
  state.specs = ([
    ["SP035-400", 35, 400, "tape"],
    ["SP035-300", 35, 300, "tape"],
    ["SP066-630", 66, 630, "wire"],
    ["SP110-800", 110, 800, "wire"],
    ["SP110-1000", 110, 1000, "wire"],
    ["SP220-1200", 220, 1200, "wire"]
  ] as const).map(([id, voltage, area, structure]) => ({
    id,
    voltage,
    area,
    cores: 1,
    structure,
    metrics: structure === "tape" ? ["dg", "by"] : ["jx", "by"],
    enabled: true,
    productType: "交联聚乙烯绝缘电缆",
    customerCode: "HV-" + id.slice(2),
    description: "35–220 kV 高压电缆演示规格，适用范围应结合设备量程与工艺确认"
  }));
  state.devices = [
    { id: "HY-DG-01", name: "金属屏蔽搭盖率检测设备", metric: "dg", line: "铜带屏蔽工位", status: "online", source: "设备自动采集", lastSeen: "2026-10-09 14:30:00", calibration: "2026-12-31", model: "HY-DG", image: "assets/images/device-dg.png", ip: "192.168.10.101" },
    { id: "HY-JX-01", name: "铜丝屏蔽相邻铜丝间隙检测设备", metric: "jx", line: "铜丝屏蔽工位", status: "online", source: "设备自动采集", lastSeen: "2026-10-09 14:30:00", calibration: "2026-12-31", model: "HY-JX", image: "assets/images/device-jx.png", ip: "192.168.10.102" },
    { id: "HY-BY-01", name: "电缆不圆度检测设备", metric: "by", line: "不圆度检测工位", status: "online", source: "设备自动采集", lastSeen: "2026-10-09 14:30:00", calibration: "2026-12-31", model: "HY-BY", image: "assets/images/device-by.png", ip: "192.168.10.103" }
  ];
  state.recipes = Object.values(METRICS).map(metric => ({
    id: metric.id.toUpperCase() + "-V1.0",
    metric: metric.id,
    version: "V1.0",
    threshold: metric.threshold,
    operator: metric.operator,
    name: metric.short + "默认演示配方",
    enabled: true,
    createdAt: "2026-10-09 08:00:00",
    description: "依据原型设定的演示阈值"
  }));
  for (let index = 0; index < 12; index += 1) {
    const metric = (["dg", "jx", "by"] as const)[index % 3];
    const recipe = state.recipes.find(item => item.metric === metric);
    if (!recipe) throw new Error("缺少默认配方");
    const number = String(index + 1).padStart(3, "0");
    const startAt = index < 3 ? (["2026-10-09 13:00:00", "2026-10-09 12:30:00", "2026-10-09 12:10:00"] as const)[index] : "2026-10-09 " + pad(8 + Math.floor((index - 3) / 3)) + ":" + pad(5 + 15 * ((index - 3) % 3)) + ":00";
    state.tasks.push({
      id: "T20261009" + number,
      workOrder: "WO20261009" + number,
      reelId: "P20261009" + number,
      specId: (["SP035-400", "SP110-800", "SP220-1200"] as const)[index % 3],
      metric,
      deviceId: state.devices[index % 3].id,
      recipeId: recipe.id,
      ruleSnapshot: snapshot(recipe),
      status: index < 3 ? "running" : "completed",
      startAt,
      endAt: index < 3 ? null : timeAdd(startAt, 1200),
      createdAt: timeAdd(startAt, -600),
      plannedLength: [2000, 3000, 4000][index % 3],
      measuredLength: index < 3 ? [1232, 2261, 3217.5][index % 3] : [2000, 3000, 4000][index % 3]
    });
  }
  const samples = {
    dg: [12.70, 13.03, 13.23, 13.21, 12.99, 9.20, 12.16, 11.94, 11.85, 12.03, 12.30, 12.61, 12.80, 12.83, 12.59, 12.25, 11.97, 11.76, 11.81, 11.93, 12.26, 12.61, 12.96, 13.12, 13.18, 12.96, 12.63, 12.32, 12.18, 12.36],
    jx: [1.80, 1.92, 1.99, 2.01, 2.01, 1.92, 1.81, 1.65, 1.59, 1.46, 1.43, 3.24, 1.62, 1.71, 1.74, 1.71, 1.61, 1.55, 1.45, 1.43, 1.52, 1.60, 1.75, 1.92, 2.02, 2.04, 2.08, 2.04, 1.95, 1.52],
    by: [4.39, 4.57, 4.71, 4.74, 4.73, 4.59, 4.39, 4.18, 3.96, 3.79, 3.67, 3.60, 3.67, 3.82, 3.96, 4.17, 4.36, 4.48, 4.57, 4.60, 4.53, 4.42, 4.26, 4.13, 4.02, 4.02, 4.10, 4.24, 4.51, 4.37]
  };
  state.tasks.forEach((task, taskIndex) => {
    const count = taskIndex < 3 ? 30 : 12;
    for (let index = 0; index < count; index += 1) {
      const time = taskIndex < 3 ? "2026-10-09 14:" + pad(index + 1) + ":00" : timeAdd(task.startAt || "", index * 60);
      const value = taskIndex < 3 ? samples[task.metric][index] : round(METRICS[task.metric].threshold * (task.metric === "dg" ? 1.25 : .55) + Math.sin(index) * .12);
      const meter = taskIndex < 3 ? round(task.measuredLength - (29 - index) * [8, 9, 7.5][taskIndex]) : round(task.plannedLength * (index + 1) / count);
      state.records.push({
        id: "R-" + task.id + "-" + pad(index + 1),
        taskId: task.id,
        metric: task.metric,
        deviceId: task.deviceId,
        reelId: task.reelId,
        workOrder: task.workOrder,
        time,
        meter,
        value,
        validity: "valid",
        judgement: judge(value, task.metric, task.ruleSnapshot),
        ruleSnapshot: clone(task.ruleSnapshot),
        image: METRICS[task.metric].image,
        source: "设备自动采集",
        platformStatus: "received",
        mesStatus: "confirmed",
        receivedAt: time,
        confirmedAt: time,
        aux: aux(task.metric, value, index)
      });
    }
  });
  const overlap = state.records.find(record => record.metric === "dg" && record.judgement === "fail");
  const gap = state.records.find(record => record.metric === "jx" && record.judgement === "fail");
  if (!overlap || !gap) throw new Error("种子缺少超限记录");
  state.alarms = [
    { id: "AL20261009001", recordId: overlap.id, taskId: overlap.taskId, metric: "dg", active: false, status: "pending", createdAt: overlap.time, recoveredAt: "2026-10-09 14:07:00", note: "搭盖率低于控制下限；当前数值已恢复，原始超限记录保留，等待人工复核。", history: [{ time: overlap.time, actor: "系统", note: "检测到搭盖率 9.20%，低于控制下限 10%", status: "pending" }, { time: "2026-10-09 14:07:00", actor: "系统", note: "当前量测恢复阈值范围，报警处理状态保持待复核", status: "pending" }] },
    { id: "AL20261009002", recordId: gap.id, taskId: gap.taskId, metric: "jx", active: false, status: "resolved", createdAt: gap.time, recoveredAt: "2026-10-09 14:13:00", note: "已复核工艺调整及后续连续记录，原始超限记录保留。", history: [{ time: gap.time, actor: "系统", note: "平均铜丝间隙 3.24 mm，高于上限 3 mm", status: "pending" }, { time: "2026-10-09 14:18:00", actor: "质量管理员", note: "复核后续记录并确认调整结果，完成处置；不覆盖原始超限记录", status: "resolved" }] }
  ];
  state.settings = { name: "慧眼智检", company: "山东沉积岩信息科技有限公司", platformName: "线缆质量管控平台", currentRole: "admin", currentUser: "质量管理员", refreshInterval: 5, autoRefresh: false, demoTime: "2026-10-09 14:30:00", demoDate: "2026-10-09", scenario: "normal", timezone: "Asia/Shanghai", retentionDays: 365, notifications: true, storageMode: "local", loginRequired: true, metricConfig: clone(METRICS) };
  state.mes = { enabled: true, url: "https://mes.example.local/api/inspection", endpoint: "https://mes.example.local/api/inspection", method: "POST", timeout: 10000, retries: 3, token: "", authType: "Bearer Token", mode: "simulation", status: "connected", lastSync: "2026-10-09 14:30:00", mapping: { taskId: "task_code", reelId: "reel_no", metric: "inspection_item", value: "measured_value", time: "measured_at" } };
  state.connections = { protocol: "HTTP", mode: "simulation", host: "127.0.0.1", port: 8080, interval: 1000, enabled: true, timeout: 10000, retries: 3, mapping: { taskId: "task_id", value: "value", time: "timestamp", meter: "meter" }, dg: { protocol: "HTTP", host: "192.168.10.101", port: 8080, enabled: true }, jx: { protocol: "HTTP", host: "192.168.10.102", port: 8080, enabled: true }, by: { protocol: "HTTP", host: "192.168.10.103", port: 8080, enabled: true } };
  state.reportTemplate = { name: "高压电缆检测报告", version: "V1.0", company: "山东沉积岩信息科技有限公司", title: "高压电缆质量检测报告", showCharts: true, showImages: true, showAlarms: true, showMES: true, showRecords: true, signatory: "质量管理员", footer: "本报告为原型演示数据，不作为产品出厂证明。" };
  state.users = [
    { id: "U001", name: "质量管理员", username: "admin", role: "admin", enabled: true, department: "质量管理部", lastLogin: "2026-10-09 08:00:00" },
    { id: "U002", name: "检测操作员", username: "operator", role: "quality", enabled: true, department: "检测车间", lastLogin: "2026-10-09 12:00:00" },
    { id: "U003", name: "质量审核员", username: "quality", role: "quality", enabled: true, department: "质量管理部", lastLogin: "2026-10-09 13:45:00" },
    { id: "U004", name: "访客", username: "viewer", role: "viewer", enabled: true, department: "演示用户", lastLogin: null }
  ];
  for (let index = 0; index < 9; index += 1) {
    const task = state.tasks[index + 3];
    const records = state.records.filter(record => record.taskId === task.id);
    state.reports.push({
      id: "RP20261009" + String(index + 1).padStart(3, "0"),
      taskId: task.id,
      kind: "final",
      createdAt: task.endAt || "",
      snapshot: clone({ task, spec: state.specs.find(item => item.id === task.specId), device: state.devices.find(item => item.id === task.deviceId), records, alarms: [], stats: stats(records), template: state.reportTemplate })
    });
  }
  state.audits = [
    { id: "AU00001", time: "2026-10-09 08:00:00", actor: "质量管理员", action: "登录系统", detail: "进入本地演示平台", role: "admin" },
    { id: "AU00002", time: "2026-10-09 12:50:00", actor: "质量管理员", action: "创建检测任务", detail: "T20261009001 · 金属屏蔽搭盖率", role: "admin" },
    { id: "AU00003", time: "2026-10-09 13:00:00", actor: "质量管理员", action: "开始检测", detail: "T20261009001 · HY-DG-01", role: "admin" },
    { id: "AU00004", time: "2026-10-09 14:06:00", actor: "系统", action: "记录超限事件", detail: "9.20% < 10%，保留原始记录", role: "system" },
    { id: "AU00005", time: "2026-10-09 14:18:00", actor: "质量管理员", action: "报警复核", detail: "AL20261009002 · 处置完成", role: "admin" },
    { id: "AU00006", time: "2026-10-09 14:30:00", actor: "系统", action: "MES确认", detail: "当前窗口 90 / 90 条记录已确认", role: "system" }
  ];
  return state;
}
