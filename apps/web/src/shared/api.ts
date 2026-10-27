export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly requestId = "") { super(message); }
}
export class ApiClient {
  csrf = "";
  guardSession = false;
  private identity = "";
  onExpired: () => void = () => {};
  constructor(private readonly send: typeof fetch = fetch) {}
  async checkSession(signal?: AbortSignal) {
    const previous = this.identity;
    const session = await this.request<{user: Person; csrf_token: string}>("/auth/me",undefined,{},signal);
    if(previous && previous !== this.identity){
      this.onExpired();
      throw new ApiError("当前账号、工厂或权限已变化，请刷新页面确认后再操作",409,"SESSION_CHANGED");
    }
    return session;
  }
  async request<T>(path: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
    if(this.guardSession && body !== undefined && path !== '/auth/login') await this.checkSession(signal);
    let response: Response;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
      response = await this.send.call(globalThis, `/api/v1${path}`, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
        headers: body === undefined ? headers : { "Content-Type": "application/json", "X-CSRF-Token": this.csrf, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    } catch (e) { if (signal?.aborted) throw e; throw new ApiError("网络请求未完成，请重试；写入将沿用原请求键", 0, "NETWORK_ERROR"); }
    finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
    const value = await response.json().catch(() => null);
    if (!response.ok || !value || value.code !== "OK") {
      if (response.status === 401 && path !== "/auth/login") this.onExpired();
      throw new ApiError(`${value?.message || "服务响应异常"}${value?.request_id ? `（请求 ${value.request_id}）` : ""}`, response.status, value?.code || "INVALID_RESPONSE", value?.request_id);
    }
    if(path === '/auth/me' || path === '/auth/login') {
      const {user,csrf_token}=value.data;
      this.csrf=csrf_token;
      this.identity=JSON.stringify([user.id,user.factory_id,[...user.permissions].sort()]);
    }
    if(path === '/auth/logout'){this.csrf='';this.identity='';}
    return value.data as T;
  }
  async all<T>(path: string): Promise<T[]> {
    const items: T[] = []; let after = "";
    do {
      const page: Page<T> = await this.request(`${path}?limit=100${after ? `&after_id=${encodeURIComponent(after)}` : ""}`);
      items.push(...page.items); after = page.has_more ? page.next_cursor || "" : "";
    } while (after);
    return items;
  }
}
export interface Page<T> { items: T[]; total?: number; has_more: boolean; next_cursor: string | null; as_of?: string; scope?: {root_id:string;task_count:number;scope_hash:string;members:Spool[]} | null }
export interface Person { id: string; name: string; username: string; factory_id: string; permissions: string[] }
export interface WorkOrder { id: string; external_code: string; specification_id: string; source_system?: string; created_at: string }
export interface Spool { id: string; spool_code: string; work_order_id: string; version?: string; canonical_spool_id?: string | null; created_at: string }
export interface Specification { code?: string; id: string; name: string; voltage_kv: string; conductor_area_mm2: string; core_count: number; shield_structure: string; enabled: boolean }
export interface Device { id: string; name: string; model: string; metric_code: string; process_id: string; line_id: string; enabled: boolean; data_environment: string }
export interface Rule { approval_state: string; method_id: string | null; method_version: string | null; comparison: { operator: string; lower: string | null; upper: string | null } | null }
export interface Recipe { code?:string; name?:string; group_id?:string; version_number?:number; unit?:string; specification_ids?:string[]; standard_reference?:string; reason?:string; actor_id?:string; created_at?:string; enabled?:boolean; version?:string; id: string; revision: string; metric_code: string; approval_state: string; rule_snapshot: Rule }
export interface SampleSummary {task_id:string;total:number;valid:number;invalid:number;passed:number;failed:number;unevaluated:number;quarantined:number;first_sample_at:string|null;latest_sample_at:string|null;minimum:string|null;maximum:string|null;mean:string|null;unit:string|null}
export interface Task { activity?:TaskActivity; measurements?:SampleSummary; current_order_code?:string; original_spool_id?: string; original_work_order_id?: string; association_version?: string; current_spool_code?: string; canonical_spool_id?: string; creation_source?: string; reported_length_m?: string | null; length_status?: string; plan_id?: string; plan_name?: string; id: string; task_code: string; work_order_id: string; spool_id: string; specification_id: string; process_id: string; device_id: string; metric_code: string; recipe_version_id: string | null; planned_length_m: string | null; state: string; version: string; rule_snapshot: Rule; data_environment: string; created_at: string; started_at: string | null; ended_at: string | null; end_reason?: string; context_snapshot: { specification: Specification; device: Device; spool_code: string; external_code: string } }
export interface Catalog { product_specification: Specification[]; device: Device[]; recipes: Recipe[]; inspection_process: { id: string; name: string }[]; production_line: { id: string; name: string }[]; specification_applicability: { specification_id: string; process_id: string; metric_code: string }[] }
export interface RawRecord { task_id: string | null; device_id: string; record_id: string; sample_time: string; position_m: string | null; position_quality: string; data_status: string; data_environment: string; capture_sequence: string; recipe_version_id: string | null; values: { metric_code: string; value: string | null; unit: string; data_status: string; reason_code: string | null }[] }
export interface BusinessContext { task_id:string; task_code:string; spool_id:string; spool_code:string; work_order_id:string; external_code:string; original_spool_id:string; original_work_order_id:string; original_spool_code:string; association_version:string }
export interface Measurement { task_id?:string|null; business_context?:BusinessContext|null; id: string; ingest_order: string; raw_payload: RawRecord; value: string | null; unit: string; metric_code: string; quality_result: string; evaluation_reason: string | null; receipt_status: string; eligibility: string; position_eligibility: string; received_at: string }
export interface DeviceStatus { device_id: string; online: boolean; last_heartbeat_at: string; heartbeat_payload: { last_sample_time?: string | null; acquisition_state?: string } }
export interface Workspace { catalog: Catalog; tasks: Task[]; spools: Spool[]; orders: WorkOrder[]; devices: DeviceStatus[] }
export const emptyWorkspace: Workspace = { catalog: { product_specification: [], device: [], recipes: [], inspection_process: [], production_line: [], specification_applicability: [] }, tasks: [], spools: [], orders: [], devices: [] };
export const names: Record<string, string> = { SHIELD_OVERLAP_RATE: "金属屏蔽搭盖率", WIRE_GAP: "铜丝屏蔽间隙", OVALITY: "电缆不圆度" };
export const codes: Record<string, string> = { dg: "SHIELD_OVERLAP_RATE", jx: "WIRE_GAP", by: "OVALITY" };
export const shortCode = (code: string) => Object.keys(codes).find(key => codes[key] === code) || "dg";
export const labelTime = (value?: string | null) => value ? value.replace("T", " ").replace("Z", " UTC") : "—";
export const taskState: Record<string, string> = { CREATED: "待开始", RUNNING: "检测中", ENDED: "已结束", CANCELLED: "已取消" };
export const quality: Record<string, string> = { PASS: "符合当前规则", FAIL: "超限", NOT_EVALUATED: "未判定" };
export function ruleText(rule: Rule) { const c = rule.comparison; return c ? `${rule.approval_state === "TEST_ONLY" ? "测试规则 · " : ""}${c.operator === "GE" ? `≥ ${c.lower}` : c.operator === "LE" ? `≤ ${c.upper}` : `${c.lower} ～ ${c.upper}`} · ${rule.method_version || "—"}` : "未批准规则 · 仅采集"; }
// Keep keys for unknown outcomes; an explicit changed command gets a new key.
export class Commands {
  private keys = new Map<string, string>();
  constructor(private api: ApiClient) {}
  async run<T>(path: string, body: unknown, version?: string): Promise<T> {
    const signature = JSON.stringify([path, body, version]);
    let key = this.keys.get(signature); if (!key) { key = crypto.randomUUID(); this.keys.set(signature, key); }
    const result = await this.api.request<T>(path, body, { "Idempotency-Key": key, ...(version ? { "If-Match": version } : {}) });
    this.keys.delete(signature); return result;
  }
}

export const specificationLabel = (s?: Specification) => s ? `${s.code||s.id} · ${s.voltage_kv}kV · ${s.conductor_area_mm2}mm² · ${s.core_count}芯` : "—";

export const spoolMembers = (data: Workspace, id: string) => { const root = data.spools.find(s => s.id === id)?.canonical_spool_id || id; return data.spools.filter(s => s.id === root || s.canonical_spool_id === root).map(s => s.id); };

export interface TaskActivity {as_of:string;observation_seconds:number;task_state:string;communication:string;last_heartbeat_at:string|null;sampling:string;received_age_seconds:number|null;sample_age_seconds:number|null;latest:{record_id:string;received_at:string;sample_time:string;value:string|null;unit:string;data_status:string;receipt_status:string;quality_result:string}|null}
export const environmentLabel=(v:string)=>v==='SIMULATED'?'模拟数据':v==='REAL'?'真实设备':v;
