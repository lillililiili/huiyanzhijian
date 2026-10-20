export type MetricId = "dg" | "jx" | "by";
export type TaskStatus = "pending" | "running" | "completed";
export type Judgement = "pass" | "fail" | "invalid";
export type Validity = "valid" | "invalid";
export type AlarmStatus = "pending" | "processing" | "resolved";
export type MesStatus = "confirmed" | "pending" | "failed";
export type PlatformStatus = "received" | "pending";
export type Scenario = "normal" | "offline" | "invalid" | "mes-failure";
export type Role = "admin" | "quality" | "viewer";
export type DemoTime = string;
export type AuditTime = string;

export interface MetricDefinition {
  id: MetricId;
  name: string;
  short: string;
  unit: string;
  threshold: number;
  operator: ">=" | "<=";
  color: string;
  icon: string;
  image: string;
}

export interface RuleSnapshot {
  id: string;
  version: string;
  threshold: number;
  operator: ">=" | "<=" | string;
}

export interface Task {
  id: string;
  workOrder: string;
  reelId: string;
  specId: string;
  metric: MetricId;
  deviceId: string;
  recipeId: string;
  ruleSnapshot: RuleSnapshot;
  status: TaskStatus;
  startAt: DemoTime | null;
  endAt: DemoTime | null;
  createdAt: DemoTime;
  plannedLength: number;
  measuredLength: number;
  assignedAt?: DemoTime;
}

export interface Spec {
  id: string;
  voltage: number;
  area: number;
  cores: number;
  structure: "tape" | "wire";
  metrics: MetricId[];
  enabled: boolean;
  productType: string;
  customerCode: string;
  description: string;
}

export interface Device {
  id: string;
  name: string;
  metric: MetricId;
  line: string;
  status: "online" | "offline";
  source: string;
  lastSeen: DemoTime;
  calibration: string;
  model: string;
  image: string;
  ip: string;
}

export interface RecordAux {
  overlapWidth?: number;
  tapeWidth?: number;
  pitch?: number;
  localGaps?: number[];
  meanGap?: number;
  xDiameter?: number;
  yDiameter?: number;
  description?: string;
}

export interface InspectionRecord {
  id: string;
  taskId: string;
  metric: MetricId;
  deviceId: string;
  reelId: string;
  workOrder: string;
  time: DemoTime;
  meter: number;
  value: number | null;
  validity: Validity;
  judgement: Judgement;
  ruleSnapshot: RuleSnapshot;
  image: string;
  source: string;
  platformStatus: PlatformStatus;
  mesStatus: MesStatus;
  receivedAt: DemoTime;
  confirmedAt: DemoTime | null;
  aux: RecordAux;
  lastSyncError?: string | null;
  scenarioOriginal?: { mesStatus: MesStatus; confirmedAt: DemoTime | null };
  scenarioGenerated?: boolean;
}

export interface AlarmHistory {
  time: DemoTime;
  actor: string;
  note: string;
  status: AlarmStatus | string;
}

export interface Alarm {
  id: string;
  recordId: string;
  taskId: string;
  metric: MetricId;
  active: boolean;
  status: AlarmStatus;
  createdAt: DemoTime;
  recoveredAt: DemoTime | null;
  note: string;
  history: AlarmHistory[];
}

export interface Recipe {
  id: string;
  metric: MetricId;
  version: string;
  threshold: number;
  operator: ">=" | "<=" | string;
  name: string;
  enabled: boolean;
  createdAt: DemoTime;
  description: string;
}

export interface Stats {
  total: number;
  valid: number;
  invalid: number;
  pass: number;
  fail: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  last: { value?: unknown; time?: string; validity?: string; judgement?: string } | null;
}

export interface ReportTemplate {
  name: string;
  version: string;
  company: string;
  title: string;
  showCharts: boolean;
  showImages: boolean;
  showAlarms: boolean;
  showMES: boolean;
  showRecords: boolean;
  signatory: string;
  footer: string;
  header?: string;
  reviewer?: string;
  includeLogo?: boolean;
  includeTrend?: boolean;
  includeAlarms?: boolean;
  includeDetails?: boolean;
  revision?: number;
  updatedAt?: DemoTime;
}

export interface ReportSnapshot {
  task: Task;
  spec: Spec | undefined;
  device: Device | undefined;
  records: InspectionRecord[];
  alarms: Alarm[];
  stats: Stats;
  template: ReportTemplate;
}

export interface Report {
  id: string;
  taskId: string;
  kind: "stage" | "final";
  createdAt: DemoTime;
  snapshot: ReportSnapshot;
}

export interface Audit {
  id: string;
  time: AuditTime;
  actor: string;
  role: Role | string;
  action: string;
  detail: string;
}

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  enabled: boolean;
  department: string;
  lastLogin: DemoTime | null;
  account?: string;
}

export interface Settings {
  name: string;
  company: string;
  platformName: string;
  organization?: string;
  currentRole: Role | string;
  currentUser: string;
  refreshInterval: number;
  autoRefresh: boolean;
  demoTime: DemoTime;
  demoDate: string;
  scenario: Scenario | string;
  timezone: string;
  retentionDays: number;
  notifications: boolean;
  storageMode: string;
  loginRequired: boolean;
  metricConfig: Record<MetricId, MetricDefinition>;
  metricDisplay?: unknown;
  pageSize?: number;
}

export interface MesConfig {
  enabled: boolean;
  url: string;
  endpoint: string;
  method: string;
  timeout: number;
  retries: number;
  token: string;
  authType: string;
  mode: string;
  status: string;
  lastSync: DemoTime;
  mapping: Record<string, string>;
}

export interface DeviceEndpoint {
  protocol: string;
  host: string;
  port: number;
  enabled: boolean;
}

export interface Connections {
  protocol: string;
  mode: string;
  host: string;
  port: number;
  interval: number;
  enabled: boolean;
  timeout: number;
  retries: number;
  mapping: Record<string, string>;
  dg: DeviceEndpoint;
  jx: DeviceEndpoint;
  by: DeviceEndpoint;
  endpoint?: string;
  heartbeat?: unknown;
  autoReconnect?: boolean;
  pollInterval?: number;
}

export interface AppState {
  schemaVersion: 1;
  tasks: Task[];
  specs: Spec[];
  devices: Device[];
  records: InspectionRecord[];
  alarms: Alarm[];
  recipes: Recipe[];
  reports: Report[];
  audits: Audit[];
  users: User[];
  settings: Settings;
  mes: MesConfig;
  connections: Connections;
  reportTemplate: ReportTemplate;
}

export interface SessionUser {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface CreateTaskInput {
  workOrder?: unknown;
  reelId?: unknown;
  specId?: string;
  metric?: string;
  deviceId?: string;
  recipeId?: string;
  plannedLength?: unknown;
}

export interface SpecDraft {
  id?: unknown;
  voltage?: unknown;
  area?: unknown;
  cores?: unknown;
  structure?: unknown;
  metrics?: unknown;
  enabled?: unknown;
  update?: boolean;
}

export interface AlarmUpdate {
  status?: string;
  note?: unknown;
  actor?: unknown;
}

export interface RecipeRevision {
  name?: unknown;
  threshold?: unknown;
  operator?: string;
  enabled?: boolean;
  description?: unknown;
}

export interface MetricDisplayInput {
  decimals?: unknown;
  description?: unknown;
}

export interface TemplateDraft {
  title?: unknown;
  signatory?: unknown;
  footer?: unknown;
  includeLogo?: unknown;
  includeTrend?: unknown;
  includeAlarms?: unknown;
  includeDetails?: unknown;
}

export interface DeviceDraft {
  id?: unknown;
  name?: unknown;
  metric?: unknown;
  line?: unknown;
  calibration?: unknown;
  status?: unknown;
  update?: boolean;
}

export interface ConnectionsDraft {
  protocol?: unknown;
  endpoint?: unknown;
  interval?: unknown;
  heartbeat?: unknown;
  autoReconnect?: unknown;
}

export interface MesDraft {
  endpoint?: unknown;
  mode?: unknown;
  timeout?: unknown;
  retries?: unknown;
  enabled?: unknown;
  token?: unknown;
}

export interface UserDraft {
  id?: unknown;
  name?: unknown;
  account?: unknown;
  role?: unknown;
  enabled?: unknown;
  update?: boolean;
}

export interface SettingsDraft {
  platformName?: unknown;
  organization?: unknown;
  refreshInterval?: unknown;
  pageSize?: unknown;
}

export interface ImportError {
  row: number;
  line: number;
  message: string;
}

export interface ImportResult {
  count: number;
  errors: ImportError[];
}

export interface SyncResult {
  count: number;
  failed: number;
  pending: number;
}
