import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { navigate } from "../app/hashRoute";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable } from "../ui/DataTable";
import { Drawer } from "../ui/Drawer";
import { Field } from "../ui/Field";
import { HashLink } from "../ui/HashLink";
import { Kpi } from "../ui/Kpi";
import { Modal } from "../ui/Modal";
import { Note } from "../ui/Note";
import { PageTitle } from "../ui/PageTitle";
import { Panel } from "../ui/Panel";
import { DefectExamples } from "./DefectExamples";
import { DateTimeField, ScopedOptions } from "./UxFields";
import {
  environmentLabel,
  labelTime,
  names,
  ruleText,
  type ApiClient,
  type Measurement,
  type Page,
  type Task,
  type Workspace
} from "./api";
import {
  actionNames,
  handlingStateMeta,
  severityMeta,
  type AlarmAggregateResult,
  type AlarmDetail,
  type AlarmItem,
  type AlarmListResponse
} from "./alarmTypes";
import "./alarms.css";

const FILTERS = ["metric_code", "task_id", "spool_id", "device_id", "environment", "from", "to"] as const;
const METRICS = [
  ["", "全部三项检测"],
  ["SHIELD_OVERLAP_RATE", names.SHIELD_OVERLAP_RATE],
  ["WIRE_GAP", names.WIRE_GAP],
  ["OVALITY", names.OVALITY]
] as const;

function taskIdOf(record: Measurement) {
  return record.raw_payload.task_id || record.task_id || record.business_context?.task_id || "";
}

function measurementUrl(params: URLSearchParams, limit: number) {
  const query = new URLSearchParams({ quality: "FAIL", order: "desc", limit: String(limit) });
  for (const key of FILTERS) if (params.get(key)) query.set(key, params.get(key)!);
  return `/measurements?${query.toString()}`;
}

export function AnomalyRecords({ api, data, params }: { api: ApiClient; data: Workspace; params: URLSearchParams }) {
  // 视图切换：'alarms' 为工业级报警工作台（默认），'raw_fails' 为底层原始超限测点
  const [activeTab, setActiveTab] = useState<"alarms" | "raw_fails">("alarms");

  // ===================== M05 工业级报警工作台状态 =====================
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [alarmKpis, setAlarmKpis] = useState<{ pending: number; processing: number; handled: number; reviewed: number }>({
    pending: 0,
    processing: 0,
    handled: 0,
    reviewed: 0
  });
  const [alarmLoading, setAlarmLoading] = useState(false);
  const [alarmError, setAlarmError] = useState("");
  const [alarmReload, setAlarmReload] = useState(0);
  const [aggregating, setAggregating] = useState(false);
  const [aggregateMsg, setAggregateMsg] = useState("");

  // 详情与流转弹窗
  const [selectedAlarm, setSelectedAlarm] = useState<AlarmItem | null>(null);
  const [alarmDetail, setAlarmDetail] = useState<AlarmDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [handleModalAlarm, setHandleModalAlarm] = useState<AlarmItem | null>(null);
  const [reviewModalAlarm, setReviewModalAlarm] = useState<AlarmItem | null>(null);
  const [reviewApproved, setReviewApproved] = useState(true);

  // 报警筛选器状态
  const [alarmFilterState, setAlarmFilterState] = useState<string>(params.get("handling_state") || "");
  const [alarmFilterSeverity, setAlarmFilterSeverity] = useState<string>(params.get("severity") || "");
  const [alarmFilterMetric, setAlarmFilterMetric] = useState<string>(params.get("metric_code") || "");
  const [alarmFilterDevice, setAlarmFilterDevice] = useState<string>(params.get("device_id") || "");
  const [alarmFilterLifecycle, setAlarmFilterLifecycle] = useState<string>(params.get("lifecycle") || "");

  // ===================== 原始超限测点状态（向后兼容保留） =====================
  const requestedLimit = Number(params.get("limit") || "25");
  const limit = [25, 50, 100].includes(requestedLimit) ? requestedLimit : 25;
  const url = measurementUrl(params, limit);
  const [pages, setPages] = useState<Page<Measurement>[]>([]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<Measurement | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const firstRequest = useRef<AbortController | null>(null);
  const pageIndex = useRef(0);
  const page = pages[index];
  const rows = page?.items || [];
  const total = page?.total;
  const queryAsOf = page?.as_of;

  useEffect(() => { pageIndex.current = index; }, [index]);

  // ===================== 加载 M05 工业级报警列表 =====================
  const loadAlarms = useCallback(async () => {
    setAlarmLoading(true);
    setAlarmError("");
    try {
      const q = new URLSearchParams({ limit: "50" });
      if (alarmFilterState) q.set("handling_state", alarmFilterState);
      if (alarmFilterSeverity) q.set("severity", alarmFilterSeverity);
      if (alarmFilterMetric) q.set("metric_code", alarmFilterMetric);
      if (alarmFilterDevice) q.set("device_id", alarmFilterDevice);
      if (alarmFilterLifecycle) q.set("lifecycle", alarmFilterLifecycle);

      // 查询当前筛选下的报警
      const res = await api.request<AlarmListResponse>(`/alarms?${q.toString()}`);
      setAlarms(res.items || []);

      // 统计各状态的报警数
      try {
        const allRes = await api.request<AlarmListResponse>("/alarms?limit=100");
        const allItems = allRes.items || [];
        setAlarmKpis({
          pending: allItems.filter(a => a.handling_state === "PENDING").length,
          processing: allItems.filter(a => a.handling_state === "PROCESSING").length,
          handled: allItems.filter(a => a.handling_state === "HANDLED").length,
          reviewed: allItems.filter(a => a.handling_state === "REVIEWED").length
        });
      } catch {
        // KPI 查询忽略降级
      }
    } catch (cause) {
      setAlarmError(cause instanceof Error ? cause.message : "获取报警列表失败");
    } finally {
      setAlarmLoading(false);
    }
  }, [api, alarmFilterState, alarmFilterSeverity, alarmFilterMetric, alarmFilterDevice, alarmFilterLifecycle]);

  useEffect(() => {
    void loadAlarms();
  }, [loadAlarms, alarmReload]);

  // 定时自动刷新报警
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadAlarms();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadAlarms]);

  // 加载单条报警详情与审计时间线
  const loadAlarmDetail = useCallback(async (alarmId: string) => {
    setDetailLoading(true);
    try {
      const detail = await api.request<AlarmDetail>(`/alarms/${encodeURIComponent(alarmId)}`);
      setAlarmDetail(detail);
    } catch {
      setAlarmDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [api]);

  function openAlarmDetail(alarm: AlarmItem) {
    setSelectedAlarm(alarm);
    void loadAlarmDetail(alarm.id);
  }

  // ===================== 报警四阶流转动作 =====================
  // 1. 操作员确认 (Ack)
  async function handleAck(alarm: AlarmItem) {
    try {
      await api.request(`/alarms/${encodeURIComponent(alarm.id)}:ack`, {});
      setAggregateMsg(`已确认报警 ${alarm.id}，状态流转为处置中`);
      setAlarmReload(v => v + 1);
      if (selectedAlarm?.id === alarm.id) void loadAlarmDetail(alarm.id);
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : "确认操作失败");
    }
  }

  // 2. 登记处置整改意见 (Handle)
  async function submitHandle(formData: FormData) {
    if (!handleModalAlarm) return;
    const opinion = String(formData.get("opinion") || "").trim();
    const actionPlan = String(formData.get("action_plan") || "").trim();
    const evidenceName = String(formData.get("evidence_name") || "").trim();
    const evidenceUrl = String(formData.get("evidence_url") || "").trim();

    if (!opinion) {
      throw new Error("请填写具体的处置意见说明");
    }

    const evidenceRefs = evidenceName && evidenceUrl ? [{ name: evidenceName, url: evidenceUrl }] : undefined;

    await api.request(`/alarms/${encodeURIComponent(handleModalAlarm.id)}:handle`, {
      opinion,
      action_plan: actionPlan || undefined,
      evidence_refs: evidenceRefs
    });

    setAggregateMsg(`报警 ${handleModalAlarm.id} 处置登记完成，已进入待主管复核`);
    setHandleModalAlarm(null);
    setAlarmReload(v => v + 1);
    if (selectedAlarm?.id === handleModalAlarm.id) void loadAlarmDetail(handleModalAlarm.id);
  }

  // 3. 主管复核审批 (Review)
  async function submitReview(formData: FormData) {
    if (!reviewModalAlarm) return;
    const opinion = String(formData.get("opinion") || "").trim();
    if (!opinion) {
      throw new Error("请填写复核意见说明");
    }

    await api.request(`/alarms/${encodeURIComponent(reviewModalAlarm.id)}:review`, {
      approved: reviewApproved,
      opinion
    });

    setAggregateMsg(`报警 ${reviewModalAlarm.id} 复核完成（结论：${reviewApproved ? "复核通过结案" : "驳回重提"}）`);
    setReviewModalAlarm(null);
    setAlarmReload(v => v + 1);
    if (selectedAlarm?.id === reviewModalAlarm.id) void loadAlarmDetail(reviewModalAlarm.id);
  }

  // 4. 手动触发超限点防抖聚合
  async function handleAggregate() {
    setAggregating(true);
    setAggregateMsg("");
    try {
      const res = await api.request<AlarmAggregateResult>("/alarms:aggregate", {});
      setAggregateMsg(`防抖聚类完成：已分析 ${res.total_fail_points} 个超限测点，新建 ${res.created_alarms} 个报警，更新 ${res.updated_alarms} 个报警`);
      setAlarmReload(v => v + 1);
    } catch (cause) {
      alert(cause instanceof Error ? cause.message : "触发报警聚合失败");
    } finally {
      setAggregating(false);
    }
  }

  // ===================== 原始超限测点加载逻辑 =====================
  const loadFirstPage = useCallback(async () => {
    if (inFlight.current) return;
    const controller = new AbortController();
    firstRequest.current = controller;
    inFlight.current = true;
    const currentGeneration = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<Page<Measurement>>(url, undefined, {}, controller.signal);
      if (currentGeneration === generation.current) {
        setPages([result]);
        setIndex(0);
        pageIndex.current = 0;
      }
    } catch (cause) {
      if (currentGeneration === generation.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "异常记录查询失败");
    } finally {
      if (firstRequest.current === controller) {
        firstRequest.current = null;
        inFlight.current = false;
        if (currentGeneration === generation.current) setBusy(false);
      }
    }
  }, [api, url]);

  useEffect(() => {
    if (activeTab !== "raw_fails") return;
    generation.current++;
    firstRequest.current?.abort();
    firstRequest.current = null;
    inFlight.current = false;
    setPages([]);
    setIndex(0);
    pageIndex.current = 0;
    setSelected(null);
    void loadFirstPage();
    return () => {
      generation.current++;
      firstRequest.current?.abort();
      firstRequest.current = null;
      inFlight.current = false;
    };
  }, [activeTab, loadFirstPage, reload]);

  async function nextPage() {
    const current = pages[index];
    if (!current?.has_more || !current.next_cursor || busy) return;
    const followingIndex = index + 1;
    if (pages[followingIndex]) {
      setIndex(followingIndex);
      pageIndex.current = followingIndex;
      return;
    }
    const currentGeneration = generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<Page<Measurement>>(`${url}&cursor=${encodeURIComponent(current.next_cursor)}`);
      if (currentGeneration === generation.current) {
        setPages(previous => [...previous.slice(0, followingIndex), result]);
        setIndex(followingIndex);
        pageIndex.current = followingIndex;
      }
    } catch (cause) {
      if (currentGeneration === generation.current) setError(cause instanceof Error ? cause.message : "下一页查询失败");
    } finally {
      if (currentGeneration === generation.current) setBusy(false);
    }
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    new FormData(event.currentTarget).forEach((value, key) => {
      if (String(value)) query.set(key, String(value));
    });
    navigate(`alarms?${query.toString()}`);
  }

  const simulatedCount = rows.filter(record => record.raw_payload.data_environment === "SIMULATED").length;
  const realCount = rows.filter(record => record.raw_payload.data_environment === "REAL").length;
  const selectedTaskId = selected ? taskIdOf(selected) : "";
  const selectedTask = selectedTaskId ? data.tasks.find(task => task.id === selectedTaskId) : undefined;
  const currentRoute = `alarms?${params.toString()}`;
  const totalPages = typeof total === "number" ? Math.max(1, Math.ceil(total / limit)) : null;

  return (
    <>
      <PageTitle
        title="报警事件"
        subtitle="M05 工业级报警工作台：基于缺陷区段防抖聚类，提供操作员确认、处置登记与主管复核全闭环管理"
        actions={
          <>
            <Button disabled={alarmLoading || busy} onClick={() => { setAlarmReload(v => v + 1); setReload(v => v + 1); }}>
              刷新最新
            </Button>
            <Button onClick={() => setAutoRefresh(v => !v)}>
              {autoRefresh ? "暂停自动刷新" : "开启自动刷新"}
            </Button>
            {activeTab === "alarms" && (
              <Button primary disabled={aggregating} onClick={() => void handleAggregate()}>
                {aggregating ? "正在聚合..." : "触发防抖聚类"}
              </Button>
            )}
          </>
        }
      />

      {aggregateMsg && (
        <Note tone="green">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span>{aggregateMsg}</span>
            <button className="btn" type="button" onClick={() => setAggregateMsg("")} style={{ padding: "2px 8px" }}>关闭</button>
          </div>
        </Note>
      )}

      {/* 视图切换 Tabs */}
      <div className="alarms-workbench-tabs">
        <button
          type="button"
          className={activeTab === "alarms" ? "active" : ""}
          onClick={() => setActiveTab("alarms")}
        >
          工业级报警事件（M05 聚类工作台 · {alarms.length}）
        </button>
        <button
          type="button"
          className={activeTab === "raw_fails" ? "active" : ""}
          onClick={() => setActiveTab("raw_fails")}
        >
          原始超限测点明细（FAIL 采样点记录 · {typeof total === "number" ? total : rows.length}）
        </button>
      </div>

      {activeTab === "alarms" ? (
        // ======================== TAB 1: 工业级报警工作台 ========================
        <>
          <div className="alarm-kpis">
            <Kpi
              label="待确认响应 (PENDING)"
              value={alarmKpis.pending}
              note="新触发的缺陷报警，操作员需优先响应"
              icon="alert-triangle"
              tone={alarmKpis.pending > 0 ? "red" : "neutral"}
            />
            <Kpi
              label="正在排查处置 (PROCESSING)"
              value={alarmKpis.processing}
              note="已确认看到，正在现场排查并登记方案"
              icon="activity"
              tone={alarmKpis.processing > 0 ? "amber" : "neutral"}
            />
            <Kpi
              label="待主管复核 (HANDLED)"
              value={alarmKpis.handled}
              note="已提交纠正措施，等待质量主管审批结案"
              icon="clock"
              tone={alarmKpis.handled > 0 ? "blue" : "neutral"}
            />
            <Kpi
              label="已复核结案 (REVIEWED)"
              value={alarmKpis.reviewed}
              note="已完整闭环并归档的工业报警"
              icon="check-circle"
              tone="green"
            />
          </div>

          <div className="filters">
            <Field label="处理状态">
              <select value={alarmFilterState} onChange={e => setAlarmFilterState(e.target.value)}>
                <option value="">全部状态</option>
                <option value="PENDING">待确认 (PENDING)</option>
                <option value="PROCESSING">处置中 (PROCESSING)</option>
                <option value="HANDLED">待主管复核 (HANDLED)</option>
                <option value="REVIEWED">已结案 (REVIEWED)</option>
              </select>
            </Field>
            <Field label="严重级别">
              <select value={alarmFilterSeverity} onChange={e => setAlarmFilterSeverity(e.target.value)}>
                <option value="">全部严重度</option>
                <option value="CRITICAL">严重缺陷 (CRITICAL)</option>
                <option value="FATAL">致命超标 (FATAL)</option>
                <option value="WARN">超限警告 (WARN)</option>
                <option value="INFO">工艺提示 (INFO)</option>
              </select>
            </Field>
            <Field label="检测项目">
              <select value={alarmFilterMetric} onChange={e => setAlarmFilterMetric(e.target.value)}>
                <option value="">全部检测项</option>
                <option value="SHIELD_OVERLAP_RATE">{names.SHIELD_OVERLAP_RATE}</option>
                <option value="WIRE_GAP">{names.WIRE_GAP}</option>
                <option value="OVALITY">{names.OVALITY}</option>
              </select>
            </Field>
            <Field label="监控设备">
              <select value={alarmFilterDevice} onChange={e => setAlarmFilterDevice(e.target.value)}>
                <option value="">全部设备</option>
                {data.catalog.device.map(d => (
                  <option key={d.id} value={d.id}>{d.id} · {names[d.metric_code] || d.metric_code}</option>
                ))}
              </select>
            </Field>
            <Field label="生命周期">
              <select value={alarmFilterLifecycle} onChange={e => setAlarmFilterLifecycle(e.target.value)}>
                <option value="">全部生命周期</option>
                <option value="ACTIVE">活动中 (ACTIVE)</option>
                <option value="RECOVERED">已自动恢复 (RECOVERED)</option>
              </select>
            </Field>
            <div className="row">
              <Button onClick={() => void loadAlarms()}>应用筛选</Button>
              <Button
                onClick={() => {
                  setAlarmFilterState("");
                  setAlarmFilterSeverity("");
                  setAlarmFilterMetric("");
                  setAlarmFilterDevice("");
                  setAlarmFilterLifecycle("");
                }}
              >
                重置
              </Button>
            </div>
          </div>

          {alarmError && <Note tone="red"><span role="alert">报警查询失败：{alarmError}</span></Note>}

          <Panel
            core
            table
            title="工业级报警事件列表"
            tools={<span className="muted small">{autoRefresh ? "每5秒后台轮询" : "自动刷新已暂停"}</span>}
          >
            {alarmLoading && !alarms.length && <Note>正在从平台加载工业级报警事件…</Note>}
            {!alarmLoading && !alarms.length && !alarmError && (
              <Note tone="green">当前筛选条件下暂无超限报警事件，产线运行平稳。</Note>
            )}
            {alarms.length > 0 && (
              <DataTable
                className="alarm-workbench-table"
                headers={["报警编号 / 级别", "检测项目 / 监控设备", "缺陷区段 / 超限峰值", "工单 / 盘号 / 任务", "处理状态 / 生命周期", "触发时间 / 确认人", "闭环操作"]}
                rows={alarms.map(alarm => {
                  const sMeta = severityMeta[alarm.severity] || { label: alarm.severity, tone: "neutral" };
                  const hMeta = handlingStateMeta[alarm.handling_state] || { label: alarm.handling_state, tone: "neutral", desc: "" };
                  const task = data.tasks.find(t => t.id === alarm.task_id);
                  const spool = data.spools.find(s => s.id === alarm.spool_id);
                  const order = data.orders.find(o => o.id === alarm.work_order_id);

                  const spoolCode = spool?.spool_code || task?.context_snapshot?.spool_code || "—";
                  const orderCode = order?.external_code || task?.context_snapshot?.external_code || "—";
                  const taskCode = task?.task_code || alarm.task_id || "未关联";

                  return [
                    <div key="id">
                      <strong style={{ fontFamily: "monospace" }}>{alarm.id}</strong>
                      <div className="alarm-badge-group" style={{ marginTop: "3px" }}>
                        <Badge tone={sMeta.tone}>{sMeta.label}</Badge>
                      </div>
                    </div>,
                    <div key="metric">
                      <strong>{names[alarm.metric_code] || alarm.metric_code}</strong>
                      <div className="small muted">{alarm.device_id}</div>
                    </div>,
                    <div key="section">
                      <span className="alarm-pos-tag">
                        {Number(alarm.start_position_m).toFixed(2)}m ~ {Number(alarm.end_position_m).toFixed(2)}m
                      </span>
                      <div className="small muted" style={{ marginTop: "2px" }}>
                        共包含 {alarm.sample_count} 个超限测点
                      </div>
                      <div className="alarm-peak-val" style={{ marginTop: "2px" }}>
                        峰值: {Number(alarm.peak_value).toFixed(4)} {alarm.unit}
                      </div>
                    </div>,
                    <div key="context">
                      <div>盘: {spoolCode}</div>
                      <div className="small muted">单: {orderCode}</div>
                      <div className="small">
                        {alarm.task_id ? (
                          <HashLink route={`task?id=${encodeURIComponent(alarm.task_id)}&back=${encodeURIComponent(currentRoute)}`}>
                            {taskCode}
                          </HashLink>
                        ) : "—"}
                      </div>
                    </div>,
                    <div key="state">
                      <Badge tone={hMeta.tone}>{hMeta.label}</Badge>
                      <div style={{ marginTop: "4px" }}>
                        <Badge tone={alarm.lifecycle === "ACTIVE" ? "red" : "green"}>
                          {alarm.lifecycle === "ACTIVE" ? "活动中" : "已恢复"}
                        </Badge>
                      </div>
                    </div>,
                    <div key="time">
                      <div>{labelTime(alarm.triggered_at)}</div>
                      <div className="small muted">
                        {alarm.acknowledged_by ? `确认人: ${alarm.acknowledged_by}` : "尚未确认"}
                      </div>
                    </div>,
                    <div key="actions" className="alarm-actions-cell">
                      {alarm.handling_state === "PENDING" && (
                        <Button primary onClick={() => void handleAck(alarm)}>
                          一键确认
                        </Button>
                      )}
                      {alarm.handling_state === "PROCESSING" && (
                        <Button primary onClick={() => setHandleModalAlarm(alarm)}>
                          登记处置
                        </Button>
                      )}
                      {alarm.handling_state === "HANDLED" && (
                        <Button primary onClick={() => { setReviewModalAlarm(alarm); setReviewApproved(true); }}>
                          主管复核
                        </Button>
                      )}
                      <Button onClick={() => openAlarmDetail(alarm)}>
                        轨迹详情
                      </Button>
                    </div>
                  ];
                })}
              />
            )}
          </Panel>

          {/* 登记处置弹窗 */}
          <Modal
            title={`登记报警处置意见与整改方案 - ${handleModalAlarm?.id || ""}`}
            open={!!handleModalAlarm}
            submitLabel="提交处置方案"
            onClose={() => setHandleModalAlarm(null)}
            onSubmit={submitHandle}
          >
            {handleModalAlarm && (
              <>
                <div className="detail-grid" style={{ marginBottom: "12px" }}>
                  <div className="meta-item"><span className="muted small">检测项</span><div>{names[handleModalAlarm.metric_code] || handleModalAlarm.metric_code}</div></div>
                  <div className="meta-item"><span className="muted small">缺陷区段</span><div>{Number(handleModalAlarm.start_position_m).toFixed(2)}m ~ {Number(handleModalAlarm.end_position_m).toFixed(2)}m</div></div>
                  <div className="meta-item"><span className="muted small">超限峰值</span><div><strong className="text-red">{Number(handleModalAlarm.peak_value).toFixed(4)} {handleModalAlarm.unit}</strong></div></div>
                  <div className="meta-item"><span className="muted small">当前状态</span><div><Badge tone="amber">处理中 (PROCESSING)</Badge></div></div>
                </div>

                <Field label="处置分析意见说明 (必填)">
                  <textarea
                    name="opinion"
                    rows={3}
                    required
                    placeholder="例：排查发现挤出机温控热电偶接触不良导致偏芯，已调节模具水压并降速生产，切除此区段电缆"
                  />
                </Field>

                <Field label="纠正预防行动方案 (选填)">
                  <textarea
                    name="action_plan"
                    rows={2}
                    placeholder="例：1. 校正下模同心度；2. 报废此区段线缆并对下批次做逐米复检"
                  />
                </Field>

                <div className="row">
                  <Field label="现场佐证凭证名称">
                    <input name="evidence_name" placeholder="例：下模检修校准记录单.pdf" />
                  </Field>
                  <Field label="凭证网络链接 / 路径">
                    <input name="evidence_url" placeholder="例：/evidence/calibration-20261028.pdf" />
                  </Field>
                </div>
              </>
            )}
          </Modal>

          {/* 主管复核审批弹窗 */}
          <Modal
            title={`质检主管复核审批 - ${reviewModalAlarm?.id || ""}`}
            open={!!reviewModalAlarm}
            submitLabel={reviewApproved ? "审批通过并结案" : "驳回并退回重新处置"}
            onClose={() => setReviewModalAlarm(null)}
            onSubmit={submitReview}
          >
            {reviewModalAlarm && (
              <>
                <div className="detail-grid" style={{ marginBottom: "12px" }}>
                  <div className="meta-item"><span className="muted small">检测项</span><div>{names[reviewModalAlarm.metric_code] || reviewModalAlarm.metric_code}</div></div>
                  <div className="meta-item"><span className="muted small">缺陷区段</span><div>{Number(reviewModalAlarm.start_position_m).toFixed(2)}m ~ {Number(reviewModalAlarm.end_position_m).toFixed(2)}m</div></div>
                  <div className="meta-item"><span className="muted small">超限峰值</span><div><strong className="text-red">{Number(reviewModalAlarm.peak_value).toFixed(4)} {reviewModalAlarm.unit}</strong></div></div>
                  <div className="meta-item"><span className="muted small">当前状态</span><div><Badge tone="blue">待主管复核 (HANDLED)</Badge></div></div>
                </div>

                <Field label="复核审批结论">
                  <div className="row" style={{ gap: "20px", padding: "6px 0" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="review_decision"
                        checked={reviewApproved}
                        onChange={() => setReviewApproved(true)}
                      />
                      <strong style={{ color: "#16a34a" }}>复核通过 (准予结案归档)</strong>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="review_decision"
                        checked={!reviewApproved}
                        onChange={() => setReviewApproved(false)}
                      />
                      <strong style={{ color: "#dc2626" }}>驳回 (整改不充分，退回重新处置)</strong>
                    </label>
                  </div>
                </Field>

                <Field label="质检主管复核审核意见 (必填)">
                  <textarea
                    name="opinion"
                    rows={3}
                    required
                    placeholder={reviewApproved ? "例：经现场复查，缺陷段已切除报废，后续150米连续采样指标合格，准予结案。" : "例：未附带模具检修校准凭据，且纠正方案未明确责任人，请补充后重新提交。"}
                  />
                </Field>
              </>
            )}
          </Modal>

          {/* 报警详情与审计时间线抽屉 */}
          <Drawer title={`工业级报警事件详情 - ${selectedAlarm?.id || ""}`} open={!!selectedAlarm} onClose={() => { setSelectedAlarm(null); setAlarmDetail(null); }}>
            {selectedAlarm && (
              <>
                <p>
                  <Badge tone={severityMeta[selectedAlarm.severity]?.tone || "neutral"}>
                    {severityMeta[selectedAlarm.severity]?.label || selectedAlarm.severity}
                  </Badge>{" "}
                  <Badge tone={handlingStateMeta[selectedAlarm.handling_state]?.tone || "neutral"}>
                    {handlingStateMeta[selectedAlarm.handling_state]?.label || selectedAlarm.handling_state}
                  </Badge>{" "}
                  <Badge tone={selectedAlarm.lifecycle === "ACTIVE" ? "red" : "green"}>
                    {selectedAlarm.lifecycle === "ACTIVE" ? "活动中" : "已自动恢复"}
                  </Badge>
                </p>

                <div className="detail-grid">
                  <div className="meta-item"><span className="muted small">报警编号</span><div><strong style={{ fontFamily: "monospace" }}>{selectedAlarm.id}</strong></div></div>
                  <div className="meta-item"><span className="muted small">检测项目</span><div>{names[selectedAlarm.metric_code] || selectedAlarm.metric_code}</div></div>
                  <div className="meta-item"><span className="muted small">监控设备</span><div>{selectedAlarm.device_id}</div></div>
                  <div className="meta-item"><span className="muted small">缺陷区段米数</span><div><strong>{Number(selectedAlarm.start_position_m).toFixed(2)}m ~ {Number(selectedAlarm.end_position_m).toFixed(2)}m</strong></div></div>
                  <div className="meta-item"><span className="muted small">连续超限测点</span><div>{selectedAlarm.sample_count} 个连续点</div></div>
                  <div className="meta-item"><span className="muted small">超限峰值</span><div><strong className="text-red">{Number(selectedAlarm.peak_value).toFixed(4)} {selectedAlarm.unit}</strong></div></div>
                  <div className="meta-item"><span className="muted small">关联任务</span><div>{selectedAlarm.task_id || "未关联"}</div></div>
                  <div className="meta-item"><span className="muted small">触发时间</span><div>{labelTime(selectedAlarm.triggered_at)}</div></div>
                  <div className="meta-item"><span className="muted small">确认时间 / 确认人</span><div>{selectedAlarm.acknowledged_at ? `${labelTime(selectedAlarm.acknowledged_at)} (${selectedAlarm.acknowledged_by})` : "尚未确认"}</div></div>
                  <div className="meta-item"><span className="muted small">恢复时间</span><div>{selectedAlarm.recovered_at ? labelTime(selectedAlarm.recovered_at) : "未恢复"}</div></div>
                </div>

                <h4 style={{ marginTop: "20px", marginBottom: "8px" }}>报警处置生命周期轨迹（时间线）</h4>
                {detailLoading && <Note>正在读取报警审计时间线…</Note>}

                {alarmDetail?.actions && alarmDetail.actions.length > 0 ? (
                  <div className="alarm-timeline">
                    {alarmDetail.actions.map(action => (
                      <div key={action.id} className={`timeline-item ${action.action}`}>
                        <div className="timeline-header">
                          <span>{actionNames[action.action] || action.action} · {action.actor_name}</span>
                          <span className="timeline-time">{labelTime(action.occurred_at)}</span>
                        </div>
                        <div className="timeline-flow">
                          <span>状态变更: </span>
                          <span className="badge">{action.from_state || "START"}</span>
                          <span>&rarr;</span>
                          <span className="badge">{action.to_state}</span>
                        </div>
                        {action.opinion && (
                          <div className="timeline-opinion">
                            {action.opinion}
                          </div>
                        )}
                        {action.evidence_refs && action.evidence_refs.length > 0 && (
                          <div className="timeline-evidence">
                            {action.evidence_refs.map((ref, idx) => (
                              <a key={idx} href={ref.url} target="_blank" rel="noopener noreferrer">
                                &#128206; {ref.name}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  !detailLoading && <Note>暂无详细审计动作记录</Note>
                )}

                <div className="alarm-drawer-footer">
                  {selectedAlarm.handling_state === "PENDING" && (
                    <Button primary onClick={() => void handleAck(selectedAlarm)}>
                      一键确认报警 (Ack)
                    </Button>
                  )}
                  {selectedAlarm.handling_state === "PROCESSING" && (
                    <Button primary onClick={() => setHandleModalAlarm(selectedAlarm)}>
                      登记处置方案
                    </Button>
                  )}
                  {selectedAlarm.handling_state === "HANDLED" && (
                    <Button primary onClick={() => { setReviewModalAlarm(selectedAlarm); setReviewApproved(true); }}>
                      主管复核审批
                    </Button>
                  )}
                  {selectedAlarm.task_id && (
                    <HashLink route={`history?task_id=${encodeURIComponent(selectedAlarm.task_id)}&quality=FAIL&return_to=${encodeURIComponent(currentRoute)}`}>
                      查看该任务全部测点
                    </HashLink>
                  )}
                </div>
              </>
            )}
          </Drawer>
        </>
      ) : (
        // ======================== TAB 2: 原始超限测点明细 ========================
        <>
          <Note tone="amber">
            当前列表展示数据库中判定为 FAIL 的测量单点记录。每条记录代表一次原始采样判定结果。若要进行防抖合并、确认、处置与复核闭环，请切换至上方的“工业级报警事件”工作台。
          </Note>

          <div className="grid cols-4">
            <Kpi label="筛选范围超限记录" value={typeof total === "number" ? total : page ? "不可用" : "—"} note="服务端数据库计数；按测量记录统计" icon="alert-triangle" tone="red" />
            <Kpi label="当前页异常记录" value={page ? rows.length : "—"} note={`每页 ${limit} 条；服务端游标分页`} icon="list" />
            <Kpi label="模拟来源（当前页）" value={page ? simulatedCount : "—"} note="明确标记为 SIMULATED 的记录" icon="activity" tone="blue" />
            <Kpi label="真实来源（当前页）" value={page ? realCount : "—"} note="明确标记为 REAL 的记录" icon="monitor" tone="green" />
          </div>

          <form className="filters" onSubmit={submitFilters}>
            <Field label="检测项目">
              <select name="metric_code" defaultValue={params.get("metric_code") || ""}>
                {METRICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="任务">
              <select name="task_id" defaultValue={params.get("task_id") || ""}>
                <option value="">全部任务</option>
                {params.get("task_id") && !data.tasks.some(task => task.id === params.get("task_id")) && (
                  <option value={params.get("task_id")!}>{params.get("task_id")}（当前目录不可见）</option>
                )}
                {data.tasks.map(task => (
                  <option key={task.id} value={task.id}>
                    {task.context_snapshot?.spool_code} · {names[task.metric_code] || task.metric_code} · {task.task_code || task.id}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="数据来源">
              <select name="environment" defaultValue={params.get("environment") || ""}>
                <option value="">全部来源</option>
                <option value="SIMULATED">模拟数据</option>
                <option value="REAL">真实设备</option>
              </select>
            </Field>
            <Field label="每页条数">
              <select name="limit" defaultValue={String(limit)}>
                {[25, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}
              </select>
            </Field>
            <details className="ux-advanced">
              <summary>更多筛选{FILTERS.filter(key => ["spool_id", "device_id", "from", "to"].includes(key) && params.has(key)).length ? "（已应用）" : ""}</summary>
              <div className="filters">
                <Field label="线缆盘号">
                  <select name="spool_id" defaultValue={params.get("spool_id") || ""}>
                    <option value="">全部线缆</option>
                    {params.get("spool_id") && !data.spools.some(spool => spool.id === params.get("spool_id")) && (
                      <option value={params.get("spool_id")!}>{params.get("spool_id")}（当前目录不可见）</option>
                    )}
                    {data.spools.map(spool => (
                      <option key={spool.id} value={spool.id}>
                        {spool.spool_code} · {data.orders.find(order => order.id === spool.work_order_id)?.external_code || "无工单"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="检测设备">
                  <select name="device_id" defaultValue={params.get("device_id") || ""}>
                    <option value="">全部设备</option>
                    <ScopedOptions selected={params.get("device_id") || null} options={data.catalog.device.map(device => ({ id: device.id, label: `${device.id} · ${names[device.metric_code] || device.metric_code}` }))} />
                  </select>
                </Field>
                <DateTimeField name="from" label="采样起点（含）" value={params.get("from")} />
                <DateTimeField name="to" label="采样终点（不含）" value={params.get("to")} />
              </div>
            </details>
            <div className="row">
              <Button primary type="submit">查询超限记录</Button>
              <HashLink route="alarms">重置</HashLink>
            </div>
          </form>

          {error && <Note tone="red"><span role="alert">异常记录查询失败：{error}</span></Note>}

          <Panel
            core
            table
            title="检测超限记录"
            tools={<span className="muted small">{queryAsOf ? `服务端快照：${labelTime(queryAsOf)}` : autoRefresh ? "每5秒刷新最新页" : "自动刷新已暂停"}</span>}
          >
            {!page && !error && <Note>正在从平台读取异常记录…</Note>}
            {page && (
              <DataTable
                emptyText={total === 0 ? "当前筛选范围没有服务端判定超限的检测记录。" : "当前页没有记录；请刷新或调整筛选条件。"}
                headers={["采样时间 / 接收时间", "线缆 / 工单 / 任务", "检测项目 / 设备", "实测值 / 规则", "来源米数", "判定 / 接收状态", "数据来源", "操作"]}
                rows={rows.map(record => {
                  const taskId = taskIdOf(record);
                  const task = taskId ? data.tasks.find(item => item.id === taskId) : undefined;
                  const spoolCode = record.business_context?.spool_code || task?.current_spool_code || task?.context_snapshot?.spool_code || "盘号未关联";
                  const orderCode = record.business_context?.external_code || task?.current_order_code || task?.context_snapshot?.external_code || "工单未关联";
                  return [
                    <div key="time">
                      {labelTime(record.raw_payload.sample_time)}
                      <div className="small muted">接收：{labelTime(record.received_at)}</div>
                    </div>,
                    <div key="context">
                      {record.business_context?.spool_id ? (
                        <HashLink route={`trace?spool=${encodeURIComponent(record.business_context.spool_id)}`}>{spoolCode}</HashLink>
                      ) : spoolCode}
                      <div>{orderCode}</div>
                      <div className="small">
                        {taskId ? (
                          <HashLink route={`task?id=${encodeURIComponent(taskId)}&back=${encodeURIComponent(currentRoute)}`}>
                            {record.business_context?.task_code || task?.task_code || taskId}
                          </HashLink>
                        ) : "未关联任务"}
                      </div>
                    </div>,
                    <div key="metric">
                      {names[record.metric_code] || record.metric_code}
                      <div className="small muted">{record.raw_payload.device_id}</div>
                    </div>,
                    <div key="value">
                      <strong className="text-red">{record.value ?? "—"} {record.unit}</strong>
                      <div className="small muted">{task ? ruleText(task.rule_snapshot) : record.evaluation_reason || "规则快照不可用"}</div>
                    </div>,
                    <div key="pos">
                      {record.raw_payload.position_m == null ? "未知" : `${record.raw_payload.position_m} m`}
                      <div className="small muted">位置未验证</div>
                    </div>,
                    <div key="status">
                      <Badge tone="red">服务端判定超限</Badge>
                      <div className="small muted">
                        {record.receipt_status === "STORED" ? "已存储" : record.receipt_status === "QUARANTINED" ? "隔离" : record.receipt_status}
                      </div>
                    </div>,
                    <div key="env">
                      {environmentLabel(record.raw_payload.data_environment)}
                      <div className="small muted">资格：{record.eligibility}</div>
                    </div>,
                    <Button key="btn" onClick={() => setSelected(record)}>记录详情</Button>
                  ];
                })}
              />
            )}
            <div className="row measurement-pagination">
              <Button disabled={index === 0 || busy} onClick={() => { setIndex(value => Math.max(0, value - 1)); pageIndex.current = Math.max(0, index - 1); }}>上一页</Button>
              <Button disabled={!page?.has_more || busy || !!error} onClick={() => void nextPage()}>下一页</Button>
              <span className="muted small">第 {page ? index + 1 : 0} / {totalPages ?? "—"} 页 · 筛选内 {typeof total === "number" ? total : "—"} 条</span>
              <span className="muted small">{autoRefresh ? index === 0 ? "第一页自动刷新中" : "已翻页；自动刷新暂不打断历史浏览" : "自动刷新已暂停"}</span>
            </div>
          </Panel>

          <Drawer title="超限测量记录" open={!!selected} onClose={() => setSelected(null)}>
            {selected && (
              <>
                <p>
                  <Badge tone="red">服务端判定超限</Badge> <strong>{selected.value ?? "—"} {selected.unit}</strong> · {names[selected.metric_code] || selected.metric_code}
                </p>
                <div className="detail-grid">
                  <div className="meta-item"><span className="muted small">记录ID</span><div>{selected.id}</div></div>
                  <div className="meta-item"><span className="muted small">线缆 / 工单 / 任务</span><div>{selected.business_context?.spool_code || selectedTask?.current_spool_code || selectedTask?.context_snapshot?.spool_code || "盘号未关联"} / {selected.business_context?.external_code || selectedTask?.current_order_code || selectedTask?.context_snapshot?.external_code || "工单未关联"} / {selected.business_context?.task_code || selectedTask?.task_code || selectedTaskId || "未关联任务"}</div></div>
                  <div className="meta-item"><span className="muted small">检测设备</span><div>{selected.raw_payload.device_id}</div></div>
                  <div className="meta-item"><span className="muted small">采样时间</span><div>{labelTime(selected.raw_payload.sample_time)}</div></div>
                  <div className="meta-item"><span className="muted small">接收时间</span><div>{labelTime(selected.received_at)}</div></div>
                  <div className="meta-item"><span className="muted small">规则快照</span><div>{selectedTask ? ruleText(selectedTask.rule_snapshot) : "任务快照不可用"}</div></div>
                  <div className="meta-item"><span className="muted small">判定原因</span><div>{selected.evaluation_reason || "—"}</div></div>
                  <div className="meta-item"><span className="muted small">数据来源 / 资格</span><div>{environmentLabel(selected.raw_payload.data_environment)} · {selected.eligibility} · {selected.receipt_status}</div></div>
                  <div className="meta-item"><span className="muted small">来源米数</span><div>{selected.raw_payload.position_m == null ? "未知" : `${selected.raw_payload.position_m} m（未验证）`}</div></div>
                </div>
                {selected.quality_result === "FAIL" && (
                  <DefectExamples api={api} record={selected} task={selectedTask as Task | undefined} compact key={selected.id} failed={1} context={`记录 ${selected.id} · ${labelTime(selected.raw_payload.sample_time)}`} />
                )}
                {selectedTaskId && (
                  <div className="row">
                    <HashLink route={`task?id=${encodeURIComponent(selectedTaskId)}&back=${encodeURIComponent(currentRoute)}`}>查看关联任务</HashLink>
                    <HashLink route={`history?task_id=${encodeURIComponent(selectedTaskId)}&quality=FAIL&return_to=${encodeURIComponent(currentRoute)}`}>查看该任务超限历史</HashLink>
                  </div>
                )}
                <details className="ux-technical">
                  <summary>原始记录与内部字段</summary>
                  <pre className="b2-json">{JSON.stringify(selected.raw_payload, null, 2)}</pre>
                </details>
              </>
            )}
          </Drawer>
        </>
      )}
    </>
  );
}
