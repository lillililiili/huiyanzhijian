import { judge as judgeValue } from "./judge";
import { isMetricId, METRICS } from "./metrics";
import { seed } from "./seed";
import { stats as summarize } from "./stats";
import { clean, clone, round, timeAdd } from "./time";
import type { Alarm, AlarmUpdate, AppState, Audit, Connections, ConnectionsDraft, CreateTaskInput, Device, DeviceDraft, ImportResult, InspectionRecord, MesConfig, MesDraft, MetricDisplayInput, MetricId, Recipe, RecipeRevision, Report, ReportTemplate, Role, SessionUser, Settings, SettingsDraft, Spec, SpecDraft, SyncResult, Task, TemplateDraft, User, UserDraft } from "./types";
import type { Persistence } from "../persistence/persistence";

const STORAGE_KEY = "huiyan-web:v1";
const DENY_WRITE_CORE = "当前为只读角色，请切换质量管理员或检测操作员后操作";
const DENY_WRITE = "当前角色为只读，不能修改演示数据。";
const DENY_ADMIN = "此操作需要系统管理员角色，请切换演示身份。";

export interface StoreOptions {
  persistence: Persistence;
  now?: () => string;
}

type StateArrayKey = "tasks" | "specs" | "devices" | "records" | "alarms" | "recipes" | "reports" | "audits" | "users";
type StateObjectKey = "settings" | "mes" | "connections" | "reportTemplate";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readFinite(value: unknown, min: number, max: number, message: string) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") throw new Error(message);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(message);
  return number;
}

function readInteger(value: unknown, min: number, max: number, message: string) {
  const number = readFinite(value, min, max, message);
  if (!Number.isInteger(number)) throw new Error(message);
  return number;
}

const USER_ROLES: Record<Role, string> = {
  admin: "系统管理员",
  quality: "质量管理员",
  viewer: "只读观察员"
};

function isRole(value: string): value is Role {
  return value === "admin" || value === "quality" || value === "viewer";
}

export interface InspectionStore {
  readonly metrics: typeof METRICS;
  readonly key: typeof STORAGE_KEY;
  getState(): AppState;
  subscribe(listener: () => void): () => void;
  readonly memoryOnly: boolean;
  setSession(user: SessionUser | null): void;
  save(): boolean;
  reset(): AppState;
  log(action: string, detail: string): Audit;
  id(prefix: string): string;
  task(id: string): Task | undefined;
  spec(id: string): Spec | undefined;
  device(id: string): Device | undefined;
  recipe(id: string): Recipe | undefined;
  record(id: string): InspectionRecord | undefined;
  alarm(id: string): Alarm | undefined;
  recordsFor(taskId: string): InspectionRecord[];
  currentRecords(metric?: MetricId): InspectionRecord[];
  judge(value: unknown, metric: string, rule?: { operator: string; threshold: number }, validity?: string): ReturnType<typeof judgeValue>;
  stats(records: Parameters<typeof summarize>[0]): ReturnType<typeof summarize>;
  createTask(input: CreateTaskInput): Task;
  startTask(id: string): Task;
  advanceTask(id: string): InspectionRecord;
  completeTask(id: string): Task;
  updateAlarm(id: string, input: AlarmUpdate): Alarm;
  reviseRecipe(id: string, input: RecipeRevision): Recipe;
  saveMetricDisplay(metricId: string, input: MetricDisplayInput): { decimals: number; description: string };
  saveTemplate(input: TemplateDraft): ReportTemplate;
  createReport(taskId: string): Report;
  retrySync(recordIds?: string[]): SyncResult;
  importRecords(rows: unknown[]): ImportResult;
  setScenario(name: string): AppState;
  saveSpec(input: SpecDraft): Spec;
  saveDevice(input: DeviceDraft): Device;
  saveConnections(input: ConnectionsDraft): Connections;
  saveMes(input: MesDraft): MesConfig;
  saveUser(input: UserDraft): User;
  saveSettings(input: SettingsDraft): Settings;
}

export function createStore(options: StoreOptions): InspectionStore {
  const now = options.now ?? (() => new Date().toISOString());
  let sequence = 0;
  let memoryOnly = false;
  let session: SessionUser | null = null;
  let state = loadState();
  const listeners = new Set<() => void>();

  function loadState() {
    const initial = seed();
    let raw: string | null;
    try {
      raw = options.persistence.read(STORAGE_KEY);
    } catch {
      memoryOnly = true;
      return initial;
    }
    if (!raw) return initial;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed) || parsed.schemaVersion !== 1) return initial;
      for (const field of ["tasks", "specs", "devices", "records", "alarms", "recipes", "reports", "audits", "users"] as const) {
        if (!Array.isArray(parsed[field])) return initial;
      }
      for (const field of ["settings", "mes", "connections", "reportTemplate"] as const) {
        const value = parsed[field];
        parsed[field] = { ...initial[field], ...(isRecord(value) ? value : {}) };
      }
      const records = parsed.records as InspectionRecord[];
      records.forEach(record => {
        const raw = record.value as unknown;
        if (raw === null || raw === "" || !Number.isFinite(Number(raw)) || record.validity === "invalid") {
          record.value = null;
          record.validity = "invalid";
          record.judgement = "invalid";
        }
        record.aux = record.aux || {};
      });
      return parsed as unknown as AppState;
    } catch {
      memoryOnly = true;
      return initial;
    }
  }

  function save() {
    try {
      options.persistence.write(STORAGE_KEY, JSON.stringify(state));
      memoryOnly = false;
    } catch {
      memoryOnly = true;
    }
    return !memoryOnly;
  }

  function emit() {
    for (const listener of listeners) listener();
  }

  function publish(touched: Array<StateArrayKey | StateObjectKey>) {
    const next: AppState = { ...state };
    for (const field of new Set<StateArrayKey | StateObjectKey>(["audits", ...touched])) {
      const value = state[field];
      if (Array.isArray(value)) next[field] = value.slice() as never;
      else next[field] = { ...value } as never;
    }
    state = next;
    save();
    emit();
  }

  function id(prefix: string) {
    sequence += 1;
    return clean(prefix || "ID") + Date.now().toString(36).toUpperCase() + sequence.toString(36).toUpperCase();
  }

  function actor() {
    return session?.name || state.settings.currentUser || "质量管理员";
  }

  function role(): Role | string {
    return session?.role || state.settings.currentRole || "admin";
  }

  function deny(kind: "core" | "write" | "admin") {
    if (!session) return;
    if (kind === "admin") {
      if (session.role !== "admin") throw new Error(DENY_ADMIN);
      return;
    }
    if (session.role === "viewer") throw new Error(kind === "core" ? DENY_WRITE_CORE : DENY_WRITE);
  }

  function log(action: string, detail: string): Audit {
    const entry: Audit = { id: id("AU"), time: now(), actor: actor(), role: role(), action: clean(action), detail: clean(detail) };
    state.audits.push(entry);
    publish([]);
    return entry;
  }

  function commit(action: string, detail: string, touched: Array<StateArrayKey | StateObjectKey>) {
    const entry: Audit = { id: id("AU"), time: now(), actor: actor(), role: role(), action: clean(action), detail: clean(detail) };
    state.audits.push(entry);
    publish(touched);
    return entry;
  }

  function rows<K extends StateArrayKey>(field: K) {
    return state[field] as Array<{ id: string }>;
  }

  function findRow<T extends { id: string }>(field: StateArrayKey, key: string) {
    return rows(field).find(row => row.id === key) as T | undefined;
  }

  function requireRow<T extends { id: string }>(field: StateArrayKey, key: string | undefined, message: string) {
    const row = key ? findRow<T>(field, key) : undefined;
    if (!row) throw new Error(message);
    return row;
  }

  function recordsFor(taskId: string) {
    return state.records.filter(record => record.taskId === taskId).sort((a, b) => a.time.localeCompare(b.time));
  }

  function currentRecords(metric?: MetricId) {
    const end = state.settings.demoTime;
    const start = timeAdd(end, -29 * 60);
    return state.records.filter(record => record.time >= start && record.time <= end && (!metric || record.metric === metric)).sort((a, b) => a.time.localeCompare(b.time));
  }

  function aux(metric: MetricId, value: number | null, sample: number) {
    if (value === null) return {};
    if (metric === "dg") return { overlapWidth: round(value / 100 * 30), tapeWidth: 30, pitch: round(30 - value / 100 * 30), description: "演示量测：搭盖宽度与节距为辅助量，不替代设备输出的搭盖率" };
    if (metric === "jx") return { localGaps: [round(value - .14), round(value + .03), round(value + .08), round(value + .03)], meanGap: value, description: "四处局部间隙的平均值作为当前平均间隙演示" };
    return { xDiameter: round(66.42 + ((sample + 1) % 3) * .01), yDiameter: 63.52, description: "X / Y 外径为辅助数据；不圆度取设备输出，计算口径另行确认，不代表全周重建" };
  }

  function updateAlarmRecovery(taskId: string, record: InspectionRecord) {
    if (record.judgement === "invalid") return;
    if (record.judgement === "pass") {
      state.alarms.filter(alarm => alarm.taskId === taskId && alarm.active && alarm.createdAt < record.time).forEach(alarm => {
        alarm.active = false;
        alarm.recoveredAt = record.time;
        alarm.history.push({ time: record.time, actor: "系统", note: "量测值恢复至阈值范围；人工处置状态保持不变", status: alarm.status });
      });
    }
    if (record.judgement === "fail") {
      const recovery = recordsFor(taskId).find(item => item.time > record.time && item.judgement === "pass");
      state.alarms.push({
        id: id("AL"),
        recordId: record.id,
        taskId,
        metric: record.metric,
        active: !recovery,
        recoveredAt: recovery ? recovery.time : null,
        status: "pending",
        createdAt: record.time,
        note: "检测到超限记录，请复核原始量测与工艺状态",
        history: [{ time: record.time, actor: "系统", note: "记录超限事件，原始量测不会被后续恢复覆盖", status: "pending" }]
      });
    }
  }

  function createTask(input: CreateTaskInput) {
    deny("core");
    if (!input || typeof input !== "object") throw new Error("请输入任务信息");
    const workOrder = clean(input.workOrder);
    const reelId = clean(input.reelId);
    if (!workOrder || !reelId) throw new Error("工单号和盘号不能为空");
    if (workOrder.length > 80 || reelId.length > 80) throw new Error("工单号和盘号不能超过 80 个字符");
    const spec = requireRow<Spec>("specs", input.specId, "请选择有效产品规格");
    if (!spec.enabled || ![35, 66, 110, 220].includes(Number(spec.voltage))) throw new Error("请选择启用的 35–220 kV 高压电缆规格");
    if (!input.metric || !isMetricId(input.metric) || !spec.metrics.includes(input.metric)) throw new Error("此规格不适用于所选检测项目");
    const metric = input.metric;
    const device = requireRow<Device>("devices", input.deviceId, "请选择执行设备");
    if (device.metric !== metric) throw new Error("设备与检测项目不匹配");
    const recipe = input.recipeId ? requireRow<Recipe>("recipes", input.recipeId, "配方不存在") : state.recipes.filter(item => item.metric === metric && item.enabled).at(-1);
    if (!recipe || !recipe.enabled || recipe.metric !== metric) throw new Error("请选择适用于该检测项目的启用配方");
    const plannedLength = Number(input.plannedLength);
    if (!Number.isFinite(plannedLength) || plannedLength <= 0 || plannedLength > 1000000) throw new Error("计划长度应在 0–1,000,000 米之间");
    if (state.tasks.some(task => task.reelId === reelId && task.metric === metric && task.status !== "completed")) throw new Error("该盘号已有未完成的同项目检测任务");
    const task: Task = { id: id("T"), workOrder, reelId, specId: spec.id, metric, deviceId: device.id, recipeId: recipe.id, ruleSnapshot: { id: recipe.id, version: recipe.version, threshold: recipe.threshold, operator: recipe.operator }, status: "pending", startAt: null, endAt: null, createdAt: state.settings.demoTime, plannedLength, measuredLength: 0 };
    state.tasks.push(task);
    commit("创建检测任务", task.id + " · " + METRICS[metric].name, ["tasks"]);
    return task;
  }

  function startTask(key: string) {
    deny("core");
    const task = requireRow<Task>("tasks", key, "任务不存在");
    if (task.status !== "pending") throw new Error("只有待执行任务可以开始检测");
    const device = requireRow<Device>("devices", task.deviceId, "设备不存在");
    if (device.status !== "online") throw new Error("执行设备离线，请先恢复设备连接");
    if (state.tasks.some(item => item.id !== key && item.deviceId === task.deviceId && item.status === "running")) throw new Error("该设备已有检测中的任务，请先完成当前任务");
    task.status = "running";
    task.startAt = state.settings.demoTime;
    commit("开始检测", key, ["tasks"]);
    return task;
  }

  function advanceTask(key: string) {
    deny("core");
    const task = requireRow<Task>("tasks", key, "任务不存在");
    if (task.status !== "running") throw new Error("只有检测中的任务可以生成下一条演示记录");
    const device = requireRow<Device>("devices", task.deviceId, "设备不存在");
    if (device.status !== "online") throw new Error("设备离线，未生成量测数据");
    const previous = recordsFor(key).at(-1);
    const time = timeAdd(previous && previous.time > state.settings.demoTime ? previous.time : state.settings.demoTime, 60);
    const index = recordsFor(key).length;
    const value = state.settings.scenario === "invalid" ? null : round(({ dg: 12.5, jx: 1.8, by: 4.3 }[task.metric]) + Math.sin(index * .55) * ({ dg: .55, jx: .24, by: .35 }[task.metric]));
    const failed = state.settings.scenario === "mes-failure";
    const record: InspectionRecord = {
      id: id("R"),
      taskId: key,
      metric: task.metric,
      deviceId: task.deviceId,
      reelId: task.reelId,
      workOrder: task.workOrder,
      time,
      meter: round(Math.min(task.plannedLength, task.measuredLength + 10)),
      value,
      validity: value === null ? "invalid" : "valid",
      judgement: judgeValue(value, task.metric, task.ruleSnapshot),
      ruleSnapshot: clone(task.ruleSnapshot),
      image: METRICS[task.metric].image,
      source: "设备自动采集",
      platformStatus: "received",
      mesStatus: failed ? "failed" : state.mes.enabled ? "confirmed" : "pending",
      receivedAt: time,
      confirmedAt: failed || !state.mes.enabled ? null : time,
      aux: aux(task.metric, value, index)
    };
    state.records.push(record);
    task.measuredLength = record.meter;
    state.settings.demoTime = time;
    device.lastSeen = time;
    updateAlarmRecovery(key, record);
    commit("生成演示量测", record.id + " · " + (value === null ? "无效数据" : value + " " + METRICS[task.metric].unit), ["records", "tasks", "settings", "devices", "alarms"]);
    return record;
  }

  function completeTask(key: string) {
    deny("core");
    const task = requireRow<Task>("tasks", key, "任务不存在");
    if (task.status !== "running") throw new Error("只有检测中的任务可以结束");
    if (!recordsFor(key).length) throw new Error("任务尚无检测记录，请先生成演示量测");
    task.status = "completed";
    task.endAt = state.settings.demoTime;
    commit("完成检测任务", key + " · 完成状态不替代最终质量结论", ["tasks"]);
    return task;
  }

  function updateAlarm(key: string, input: AlarmUpdate) {
    deny("write");
    const alarm = requireRow<Alarm>("alarms", key, "报警不存在");
    if (!input || !["pending", "processing", "resolved"].includes(input.status || "")) throw new Error("请选择有效的报警处理状态");
    const note = clean(input.note);
    if (!note) throw new Error("请输入复核或处置说明");
    if (input.status === "resolved" && alarm.active) throw new Error("当前超限尚未恢复，需恢复量测后再完成处置");
    alarm.status = input.status as Alarm["status"];
    alarm.note = note;
    alarm.history.push({ time: state.settings.demoTime, actor: clean(input.actor) || state.settings.currentUser || "质量管理员", note, status: input.status || "" });
    commit("报警复核", key + " · " + note, ["alarms"]);
    return alarm;
  }

  function reviseRecipe(key: string, input: RecipeRevision) {
    deny("write");
    const old = requireRow<Recipe>("recipes", key, "配方不存在");
    const threshold = Number(input && input.threshold);
    const operator = input && input.operator || old.operator;
    if (!input || input.threshold === "" || input.threshold === null || !Number.isFinite(threshold) || threshold < 0 || threshold > (old.metric === "jx" ? 100 : 100)) throw new Error("请输入 0–100 范围内的有效阈值");
    if (operator !== METRICS[old.metric].operator) throw new Error("搭盖率使用下限 ≥，铜丝间隙与不圆度使用上限 ≤");
    const versions = state.recipes.filter(recipe => recipe.metric === old.metric);
    const minor = Math.max(...versions.map(recipe => Number((recipe.version || "V1.0").split(".")[1]) || 0)) + 1;
    const next: Recipe = { ...clone(old), id: old.metric.toUpperCase() + "-V1." + minor, version: "V1." + minor, threshold, operator, name: clean(input.name) || old.name, enabled: input.enabled === undefined ? true : Boolean(input.enabled), createdAt: state.settings.demoTime, description: clean(input.description) || old.description };
    versions.forEach(recipe => { recipe.enabled = false; });
    state.recipes.push(next);
    commit("发布配方新版本", old.id + " → " + next.id + "；历史任务与记录规则保持不变", ["recipes"]);
    return next;
  }

  function saveMetricDisplay(metricId: string, input: MetricDisplayInput) {
    deny("write");
    if (!isMetricId(metricId)) throw new Error("请选择有效的检测项目");
    const decimals = Number(input?.decimals);
    if (input == null || input.decimals === "" || input.decimals === null || !Number.isInteger(decimals) || decimals < 0 || decimals > 4) throw new Error("小数位数只允许 0–4");
    const previous = isRecord(state.settings.metricDisplay) ? state.settings.metricDisplay : {};
    const saved = { decimals, description: clean(input.description) };
    state.settings = { ...state.settings, metricDisplay: { ...previous, [metricId]: saved } };
    commit("更新指标显示配置", METRICS[metricId].name, ["settings"]);
    return saved;
  }

  /** `revision` starts at 1 when missing, so the first save is 2 / V1.1. */
  function saveTemplate(input: TemplateDraft): ReportTemplate {
    deny("write");
    const title = clean(input?.title);
    if (!title) throw new Error("请填写报告抬头");
    const current = state.reportTemplate;
    const revision = Number(current.revision || 1) + 1;
    const next: ReportTemplate = {
      ...current,
      title,
      header: title,
      signatory: clean(input?.signatory),
      footer: clean(input?.footer),
      includeLogo: input?.includeLogo === true,
      includeTrend: input?.includeTrend === true,
      includeAlarms: input?.includeAlarms === true,
      includeDetails: input?.includeDetails === true,
      revision,
      version: "V1." + (revision - 1),
      updatedAt: now()
    };
    state.reportTemplate = next;
    commit("修改报告模板", "版本 V1." + (revision - 1), ["reportTemplate"]);
    return next;
  }

  function saveSpec(input: SpecDraft): Spec {
    deny("core");
    if (!input || typeof input !== "object") throw new Error("请输入规格信息");
    const id = clean(input.id);
    if (!id) throw new Error("请填写规格编号");
    if (id.length > 40) throw new Error("规格编号不能超过 40 个字符");
    const voltage = Number(input.voltage);
    if (![35, 66, 110, 220].includes(voltage)) throw new Error("电压只允许 35、66、110、220 kV");
    const area = Number(input.area);
    if (!Number.isFinite(area) || area < 1 || area > 100000) throw new Error("请输入有效的导体截面积");
    const cores = Number(input.cores);
    if (!Number.isInteger(cores) || cores < 1 || cores > 10) throw new Error("芯数应在 1–10 之间");
    if (input.structure !== "tape" && input.structure !== "wire") throw new Error("请选择屏蔽结构");
    if (!Array.isArray(input.metrics)) throw new Error("至少选择一个适用检测项目");
    const keys: MetricId[] = [];
    for (const item of input.metrics) {
      const metric = clean(item);
      if (!isMetricId(metric)) throw new Error("请选择有效的检测项目");
      if (!keys.includes(metric)) keys.push(metric);
    }
    if (!keys.length) throw new Error("至少选择一个适用检测项目");
    if (input.structure === "tape" && keys.includes("jx")) throw new Error("铜带屏蔽规格不适用铜丝间隙检测");
    if (input.structure === "wire" && keys.includes("dg")) throw new Error("铜丝屏蔽规格不适用金属屏蔽搭盖率检测");
    const existing = findRow<Spec>("specs", id);
    if (input.update && !existing) throw new Error("规格不存在");
    if (!input.update && existing) throw new Error("规格编号已存在");
    const next: Spec = {
      id,
      voltage,
      area,
      cores,
      structure: input.structure,
      metrics: keys,
      enabled: input.enabled === true || input.enabled === "true",
      productType: existing?.productType || "交联聚乙烯绝缘电缆",
      customerCode: existing?.customerCode || "",
      description: existing?.description || ""
    };
    if (existing) {
      Object.assign(existing, next);
      commit("修改产品规格", id, ["specs"]);
      return existing;
    }
    state.specs.push(next);
    commit("新增产品规格", id, ["specs"]);
    return next;
  }

  function saveDevice(input: DeviceDraft): Device {
    deny("admin");
    if (!input || typeof input !== "object") throw new Error("请输入设备信息");
    const id = clean(input.id);
    if (!id) throw new Error("请填写设备编号");
    if (id.length > 40) throw new Error("设备编号不能超过 40 个字符");
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("设备编号仅支持字母、数字、下划线和短横线");
    const name = clean(input.name);
    if (!name) throw new Error("请填写设备名称");
    const metric = clean(input.metric);
    if (!isMetricId(metric)) throw new Error("请选择有效的检测项目");
    const line = clean(input.line);
    if (!line) throw new Error("请填写产线或工位");
    if (input.status !== "online" && input.status !== "offline") throw new Error("请选择连接状态");
    const status = input.status;
    const existing = findRow<Device>("devices", id);
    if (input.update && !existing) throw new Error("设备不存在");
    if (!input.update && existing) throw new Error("设备编号已存在。");
    if (existing && state.records.some(record => record.deviceId === id) && metric !== existing.metric) {
      throw new Error("已有测量记录的设备不能修改检测类型");
    }
    const calibration = clean(input.calibration);
    if (existing) {
      Object.assign(existing, {
        name,
        metric,
        line,
        calibration,
        status,
        source: existing.source || "设备自动采集",
        lastSeen: existing.lastSeen || state.settings.demoTime
      });
      commit("编辑设备档案", id, ["devices"]);
      return existing;
    }
    const created: Device = {
      id,
      name,
      metric,
      line,
      status,
      source: "设备自动采集",
      lastSeen: state.settings.demoTime,
      calibration,
      model: "",
      image: `assets/images/device-${metric}.png`,
      ip: ""
    };
    state.devices.push(created);
    commit("新增设备", id, ["devices"]);
    return created;
  }

  function saveConnections(input: ConnectionsDraft): Connections {
    deny("admin");
    if (!input || typeof input !== "object") throw new Error("请输入接入配置");
    const protocol = clean(input.protocol);
    if (protocol !== "HTTP" && protocol !== "MQTT" && protocol !== "OPC UA") throw new Error("请选择有效的接入协议");
    const endpoint = clean(input.endpoint);
    if (!endpoint) throw new Error("请填写演示接入地址");
    const interval = readFinite(input.interval, 100, 60000, "采样间隔须在 100–60000 ms");
    const heartbeat = readFinite(input.heartbeat, 1, 300, "心跳超时须在 1–300 秒");
    state.connections = {
      ...state.connections,
      protocol,
      endpoint,
      interval,
      pollInterval: interval,
      heartbeat,
      autoReconnect: input.autoReconnect === true
    };
    commit("修改数据接入配置", "本地模拟 · " + protocol, ["connections"]);
    return state.connections;
  }

  function saveMes(input: MesDraft): MesConfig {
    deny("admin");
    if (!input || typeof input !== "object") throw new Error("请输入 MES 配置");
    const endpoint = clean(input.endpoint);
    if (!/^https?:\/\//i.test(endpoint)) throw new Error("演示地址须为 http 或 https 地址。");
    const mode = clean(input.mode);
    if (mode !== "record" && mode !== "batch") throw new Error("请选择推送方式");
    const timeout = readInteger(input.timeout, 1000, 60000, "请求超时须在 1000–60000 ms");
    const retries = readInteger(input.retries, 0, 10, "重试上限须在 0–10 次");
    state.mes = {
      ...state.mes,
      endpoint,
      url: endpoint,
      mode,
      timeout,
      retries,
      enabled: input.enabled === true
    };
    commit("修改 MES 接口配置", "本地模拟配置", ["mes"]);
    return state.mes;
  }

  function saveUser(input: UserDraft): User {
    deny("admin");
    if (!input || typeof input !== "object") throw new Error("请输入用户信息");
    const name = clean(input.name);
    if (!name) throw new Error("请填写用户姓名");
    const account = clean(input.account);
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(account)) throw new Error("登录账号须为 3–40 位字母、数字、点、下划线或短横线");
    const roleText = clean(input.role);
    if (!isRole(roleText)) throw new Error("请选择有效的角色");
    const enabled = input.enabled === true || input.enabled === "true";
    const existing = input.update ? findRow<User>("users", clean(input.id)) : undefined;
    if (input.update && !existing) throw new Error("用户不存在");
    if (state.users.some(item => item.id !== existing?.id && (item.account || item.username) === account)) {
      throw new Error("该账号已经存在。");
    }
    if (existing && existing.role === "admin" && existing.enabled !== false && (roleText !== "admin" || !enabled) && state.users.filter(item => item.role === "admin" && item.enabled !== false).length <= 1) {
      throw new Error("至少保留一位启用的系统管理员。");
    }
    if (session && existing && existing.id === session.id && !enabled) throw new Error("当前会话用户不能停用自己。");
    if (existing) {
      Object.assign(existing, { name, account, username: account, role: roleText, enabled });
      if (session && session.id === existing.id) session = { ...session, name, role: roleText };
      commit("修改用户与角色", account + " · " + USER_ROLES[roleText], ["users"]);
      return existing;
    }
    const created: User = {
      id: id("U"),
      name,
      username: account,
      account,
      role: roleText,
      enabled,
      department: "",
      lastLogin: null
    };
    state.users.push(created);
    commit("新增演示用户", account + " · " + USER_ROLES[roleText], ["users"]);
    return created;
  }

  function saveSettings(input: SettingsDraft): Settings {
    deny("admin");
    if (!input || typeof input !== "object") throw new Error("请输入系统设置");
    const platformName = clean(input.platformName);
    if (!platformName) throw new Error("请填写平台名称");
    const organization = clean(input.organization);
    if (!organization) throw new Error("请填写所属机构");
    const refreshInterval = Number(input.refreshInterval);
    if (![2, 5, 10, 30].includes(refreshInterval)) throw new Error("请选择回放刷新间隔");
    const pageSize = Number(input.pageSize);
    if (![8, 10, 20].includes(pageSize)) throw new Error("请选择默认分页大小");
    state.settings = { ...state.settings, platformName, organization, company: organization, refreshInterval, pageSize };
    commit("修改系统设置", "平台名称、机构与演示偏好", ["settings"]);
    return state.settings;
  }

  function createReport(taskId: string) {
    deny("core");
    const task = requireRow<Task>("tasks", taskId, "任务不存在");
    const records = recordsFor(taskId);
    const alarms = state.alarms.filter(alarm => alarm.taskId === taskId);
    if (!records.length) throw new Error("尚无检测记录，不能生成报告");
    if (task.status === "pending") throw new Error("待执行任务不能生成报告");
    const kind = task.status === "completed" ? "final" : "stage";
    if (kind === "final" && alarms.some(alarm => alarm.status !== "resolved")) throw new Error("请先完成关联报警的复核处置，再生成最终报告");
    if (kind === "final" && !summarize(records).valid) throw new Error("任务没有有效量测记录，不能生成最终报告");
    const report: Report = {
      id: id("RP"),
      taskId,
      kind,
      createdAt: state.settings.demoTime,
      snapshot: clone({ task, spec: findRow<Spec>("specs", task.specId), device: findRow<Device>("devices", task.deviceId), records, alarms, stats: summarize(records), template: state.reportTemplate })
    };
    state.reports.push(report);
    commit("生成" + (kind === "stage" ? "阶段" : "最终") + "报告", report.id + " · " + taskId, ["reports"]);
    return report;
  }

  function retrySync(recordIds?: string[]) {
    deny("write");
    if (recordIds !== undefined && !Array.isArray(recordIds)) throw new Error("待同步记录应为编号数组");
    if (!state.mes.enabled) throw new Error("MES 接口未启用");
    const requested = recordIds ? new Set(recordIds) : null;
    if (requested && [...requested].some(key => !findRow<InspectionRecord>("records", key))) throw new Error("包含不存在的检测记录");
    const records = state.records.filter(record => (!requested || requested.has(record.id)) && record.mesStatus !== "confirmed");
    let count = 0;
    records.forEach(record => {
      if (record.platformStatus !== "received") return;
      if (state.settings.scenario === "mes-failure") {
        record.mesStatus = "failed";
        record.lastSyncError = "演示 MES 连接失败，请切换正常场景后重试";
        return;
      }
      record.mesStatus = "confirmed";
      record.confirmedAt = state.settings.demoTime;
      record.lastSyncError = null;
      count += 1;
    });
    state.mes.lastSync = state.settings.demoTime;
    commit("MES 同步重试", count + " 条已确认，" + (records.length - count) + " 条未确认；已确认记录不重复发送", ["records", "mes"]);
    return { count, failed: records.filter(record => record.mesStatus === "failed").length, pending: records.filter(record => record.mesStatus === "pending").length };
  }

  function importRecords(input: unknown[]): ImportResult {
    deny("core");
    if (!Array.isArray(input)) throw new Error("导入内容必须为检测记录数组");
    if (input.length > 10000) throw new Error("单次最多导入 10,000 条记录");
    const errors: ImportResult["errors"] = [];
    const accepted: InspectionRecord[] = [];
    const seen = new Set(state.records.map(record => [record.taskId, record.time, record.meter].join("|")));
    input.forEach((row, index) => {
      try {
        if (!isRecord(row)) throw new Error("记录格式无效");
        const task = requireRow<Task>("tasks", clean(row.taskId), "请填写已存在的任务编号");
        const metricText = clean(row.metric) || task.metric;
        if (!isMetricId(metricText) || metricText !== task.metric) throw new Error("检测项目必须为 dg / jx / by，且与任务一致");
        if (row.deviceId && row.deviceId !== task.deviceId || row.reelId && row.reelId !== task.reelId || row.workOrder && row.workOrder !== task.workOrder) throw new Error("设备、盘号或工单号与任务不匹配");
        const time = clean(row.time).replace("T", " ").replace(/Z$/, "");
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) || !Number.isFinite(Date.parse(time.replace(" ", "T") + "Z"))) throw new Error("时间格式应为 YYYY-MM-DD HH:mm:ss");
        if (new Date(time.replace(" ", "T") + "Z").toISOString().slice(0, 19).replace("T", " ") !== time) throw new Error("日期或时间超出有效范围");
        const meter = Number(row.meter);
        if (row.meter === "" || row.meter === null || row.meter === undefined || !Number.isFinite(meter) || meter < 0) throw new Error("米数位置必须为非负数字");
        const validity = clean(row.validity) || "valid";
        if (!["valid", "invalid"].includes(validity)) throw new Error("有效性仅支持 valid / invalid");
        let value: number | null = null;
        if (validity === "valid") {
          if (row.value === null || row.value === undefined || clean(row.value) === "" || typeof row.value === "boolean" || !Number.isFinite(Number(row.value)) || Number(row.value) < 0) throw new Error("有效记录必须包含非负量测值，缺失值不能按零处理");
          value = Number(row.value);
        }
        const duplicate = [task.id, time, meter].join("|");
        if (seen.has(duplicate)) throw new Error("同一任务、时间和米数的记录已存在");
        const record: InspectionRecord = {
          id: id("R"),
          taskId: task.id,
          metric: metricText,
          deviceId: task.deviceId,
          reelId: task.reelId,
          workOrder: task.workOrder,
          time,
          meter,
          value,
          validity: validity as InspectionRecord["validity"],
          judgement: judgeValue(value, metricText, task.ruleSnapshot, validity),
          ruleSnapshot: clone(task.ruleSnapshot),
          image: METRICS[metricText].image,
          source: "人工导入补录",
          platformStatus: "received",
          mesStatus: "pending",
          receivedAt: state.settings.demoTime,
          confirmedAt: null,
          aux: aux(metricText, value, index)
        };
        accepted.push(record);
        seen.add(duplicate);
      } catch (error) {
        errors.push({ row: index + 1, line: index + 2, message: error instanceof Error ? error.message : "记录格式无效" });
      }
    });
    accepted.forEach(record => {
      state.records.push(record);
      updateAlarmRecovery(record.taskId, record);
    });
    commit("导入检测记录", accepted.length + " 条成功，" + errors.length + " 条未导入", ["records", "alarms"]);
    return { count: accepted.length, errors };
  }

  function setScenario(name: string) {
    deny("admin");
    if (!["offline", "invalid", "mes-failure", "normal"].includes(name)) throw new Error("未知演示场景");
    state.settings.scenario = name;
    state.devices.forEach(device => { device.status = name === "offline" && device.metric === "dg" ? "offline" : "online"; });
    state.mes.status = name === "mes-failure" ? "error" : "connected";
    if (name === "mes-failure") {
      currentRecords().slice(-3).forEach(record => {
        if (!record.scenarioOriginal) record.scenarioOriginal = { mesStatus: record.mesStatus, confirmedAt: record.confirmedAt };
        record.mesStatus = "failed";
        record.confirmedAt = null;
        record.lastSyncError = "演示 MES 连接失败";
      });
    }
    if (name === "invalid") {
      const task = state.tasks.find(item => item.status === "running" && item.metric === "dg");
      if (task) {
        const latest = recordsFor(task.id).at(-1);
        if (latest) {
          const time = timeAdd(state.settings.demoTime, 60);
          const record: InspectionRecord = { ...clone(latest), id: id("R"), time, value: null, validity: "invalid", judgement: "invalid", aux: {}, receivedAt: time, confirmedAt: time, scenarioGenerated: true };
          state.records.push(record);
          state.settings.demoTime = time;
        }
      }
    }
    commit("切换演示场景", name === "normal" ? "正常场景；历史无效、超限和失败记录保留，失败同步可单独重试" : name, ["settings", "devices", "mes", "records"]);
    return state;
  }

  return {
    metrics: METRICS,
    key: STORAGE_KEY,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get memoryOnly() { return memoryOnly; },
    setSession(user) { session = user; },
    save,
    reset() {
      deny("admin");
      state = seed();
      sequence = 0;
      save();
      emit();
      return state;
    },
    log,
    id,
    task: key => findRow<Task>("tasks", key),
    spec: key => findRow<Spec>("specs", key),
    device: key => findRow<Device>("devices", key),
    recipe: key => findRow<Recipe>("recipes", key),
    record: key => findRow<InspectionRecord>("records", key),
    alarm: key => findRow<Alarm>("alarms", key),
    recordsFor,
    currentRecords,
    judge: judgeValue,
    stats: summarize,
    createTask,
    startTask,
    advanceTask,
    completeTask,
    updateAlarm,
    reviseRecipe,
    saveMetricDisplay,
    saveTemplate,
    createReport,
    retrySync,
    importRecords,
    setScenario,
    saveSpec,
    saveDevice,
    saveConnections,
    saveMes,
    saveUser,
    saveSettings
  };
}
