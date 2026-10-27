import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { navigate } from "../app/hashRoute";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataTable } from "../ui/DataTable";
import { Drawer } from "../ui/Drawer";
import { Field } from "../ui/Field";
import { HashLink } from "../ui/HashLink";
import { Kpi } from "../ui/Kpi";
import { Note } from "../ui/Note";
import { PageTitle } from "../ui/PageTitle";
import { Panel } from "../ui/Panel";
import { DefectExamples } from "./DefectExamples";
import { DateTimeField, ScopedOptions } from "./UxFields";
import { environmentLabel, labelTime, names, ruleText, type ApiClient, type Measurement, type Page, type Task, type Workspace } from "./api";

const FILTERS = ["metric_code", "task_id", "spool_id", "device_id", "environment", "from", "to"] as const;
const METRICS = [
  ["", "全部三项检测"],
  ["SHIELD_OVERLAP_RATE", names.SHIELD_OVERLAP_RATE],
  ["WIRE_GAP", names.WIRE_GAP],
  ["OVALITY", names.OVALITY],
] as const;

function taskIdOf(record: Measurement) {
  return record.raw_payload.task_id || record.task_id || record.business_context?.task_id || "";
}

function measurementUrl(params: URLSearchParams, limit: number) {
  const query = new URLSearchParams({ quality: "FAIL", order: "desc", limit: String(limit) });
  for (const key of FILTERS) if (params.get(key)) query.set(key, params.get(key)!);
  return `/measurements?${query}`;
}

export function AnomalyRecords({ api, data, params }: { api: ApiClient; data: Workspace; params: URLSearchParams }) {
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
  }, [loadFirstPage, reload]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      if (pageIndex.current === 0) void loadFirstPage();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadFirstPage]);

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

  return <>
    <PageTitle title="报警事件" subtitle="按平台已保存的服务端检测判定，查看真实超限测量记录" actions={<>
      <Button disabled={busy} onClick={() => setReload(value => value + 1)}>刷新最新记录</Button>
      <Button onClick={() => setAutoRefresh(value => !value)}>{autoRefresh ? "暂停自动刷新" : "开启自动刷新"}</Button>
    </>} />

    <Note tone="amber">当前列表展示数据库中判定为 FAIL 的测量记录。每条记录代表一次超限检测结果，不等同于已创建的正式报警事件；事件合并、恢复、确认、人工处置和复核属于尚未实现的 M05。</Note>

    <div className="grid cols-4">
      <Kpi label="筛选范围超限记录" value={typeof total === "number" ? total : page ? "不可用" : "—"} note="服务端数据库计数；按测量记录统计" icon="alert-triangle" tone="red" />
      <Kpi label="当前页异常记录" value={page ? rows.length : "—"} note={`每页 ${limit} 条；服务端游标分页`} icon="list" />
      <Kpi label="模拟来源（当前页）" value={page ? simulatedCount : "—"} note="明确标记为 SIMULATED 的记录" icon="activity" tone="blue" />
      <Kpi label="真实来源（当前页）" value={page ? realCount : "—"} note="明确标记为 REAL 的记录" icon="monitor" tone="green" />
    </div>

    <form className="filters" onSubmit={submitFilters}>
      <Field label="检测项目"><select name="metric_code" defaultValue={params.get("metric_code") || ""}>{METRICS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="任务"><select name="task_id" defaultValue={params.get("task_id") || ""}>
        <option value="">全部任务</option>
        {params.get("task_id") && !data.tasks.some(task => task.id === params.get("task_id")) && <option value={params.get("task_id")!}>{params.get("task_id")}（当前目录不可见）</option>}
        {data.tasks.map(task => <option key={task.id} value={task.id}>{task.context_snapshot.spool_code} · {names[task.metric_code] || task.metric_code} · {task.task_code || task.id}</option>)}
      </select></Field>
      <Field label="数据来源"><select name="environment" defaultValue={params.get("environment") || ""}><option value="">全部来源</option><option value="SIMULATED">模拟数据</option><option value="REAL">真实设备</option></select></Field>
      <Field label="每页条数"><select name="limit" defaultValue={String(limit)}>{[25, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></Field>
      <details className="ux-advanced">
        <summary>更多筛选{FILTERS.filter(key => ["spool_id", "device_id", "from", "to"].includes(key) && params.has(key)).length ? "（已应用）" : ""}</summary>
        <div className="filters">
          <Field label="线缆盘号"><select name="spool_id" defaultValue={params.get("spool_id") || ""}>
            <option value="">全部线缆</option>
            {params.get("spool_id") && !data.spools.some(spool => spool.id === params.get("spool_id")) && <option value={params.get("spool_id")!}>{params.get("spool_id")}（当前目录不可见）</option>}
            {data.spools.map(spool => <option key={spool.id} value={spool.id}>{spool.spool_code} · {data.orders.find(order => order.id === spool.work_order_id)?.external_code || "无工单"}</option>)}
          </select></Field>
          <Field label="检测设备"><select name="device_id" defaultValue={params.get("device_id") || ""}><option value="">全部设备</option><ScopedOptions selected={params.get("device_id") || null} options={data.catalog.device.map(device => ({ id: device.id, label: `${device.id} · ${names[device.metric_code] || device.metric_code}` }))} /></select></Field>
          <DateTimeField name="from" label="采样起点（含）" value={params.get("from")} />
          <DateTimeField name="to" label="采样终点（不含）" value={params.get("to")} />
        </div>
      </details>
      <div className="row"><Button primary type="submit">查询超限记录</Button><HashLink route="alarms">重置</HashLink></div>
    </form>

    {error && <Note tone="red"><span role="alert">异常记录查询失败：{error}</span></Note>}

    <Panel core table title="检测超限记录" tools={<span className="muted small">{queryAsOf ? `服务端快照：${labelTime(queryAsOf)}` : autoRefresh ? "每5秒刷新最新页" : "自动刷新已暂停"}</span>}>
      {!page && !error && <Note>正在从平台读取异常记录…</Note>}
      {page && <DataTable emptyText={total === 0 ? "当前筛选范围没有服务端判定超限的检测记录。" : "当前页没有记录；请刷新或调整筛选条件。"} headers={["采样时间 / 接收时间", "线缆 / 工单 / 任务", "检测项目 / 设备", "实测值 / 规则", "来源米数", "判定 / 接收状态", "数据来源", "操作"]} rows={rows.map(record => {
        const taskId = taskIdOf(record);
        const task = taskId ? data.tasks.find(item => item.id === taskId) : undefined;
        const spoolCode = record.business_context?.spool_code || task?.current_spool_code || task?.context_snapshot.spool_code || "盘号未关联";
        const orderCode = record.business_context?.external_code || task?.current_order_code || task?.context_snapshot.external_code || "工单未关联";
        return [
          <>{labelTime(record.raw_payload.sample_time)}<div className="small muted">接收：{labelTime(record.received_at)}</div></>,
          <>{record.business_context?.spool_id ? <HashLink route={`trace?spool=${encodeURIComponent(record.business_context.spool_id)}`}>{spoolCode}</HashLink> : spoolCode}<div>{orderCode}</div><div className="small">{taskId ? <HashLink route={`task?id=${encodeURIComponent(taskId)}&back=${encodeURIComponent(currentRoute)}`}>{record.business_context?.task_code || task?.task_code || taskId}</HashLink> : "未关联任务"}</div></>,
          <>{names[record.metric_code] || record.metric_code}<div className="small muted">{record.raw_payload.device_id}</div></>,
          <><strong className="text-red">{record.value ?? "—"} {record.unit}</strong><div className="small muted">{task ? ruleText(task.rule_snapshot) : record.evaluation_reason || "规则快照不可用"}</div></>,
          <>{record.raw_payload.position_m == null ? "未知" : `${record.raw_payload.position_m} m`}<div className="small muted">位置未验证</div></>,
          <><Badge tone="red">服务端判定超限</Badge><div className="small muted">{record.receipt_status === "STORED" ? "已存储" : record.receipt_status === "QUARANTINED" ? "隔离" : record.receipt_status}</div></>,
          <>{environmentLabel(record.raw_payload.data_environment)}<div className="small muted">资格：{record.eligibility}</div></>,
          <Button onClick={() => setSelected(record)}>记录详情</Button>
        ];
      })} />}
      <div className="row measurement-pagination">
        <Button disabled={index === 0 || busy} onClick={() => { setIndex(value => Math.max(0, value - 1)); pageIndex.current = Math.max(0, index - 1); }}>上一页</Button>
        <Button disabled={!page?.has_more || busy || !!error} onClick={() => void nextPage()}>下一页</Button>
        <span className="muted small">第 {page ? index + 1 : 0} / {totalPages ?? "—"} 页 · 筛选内 {typeof total === "number" ? total : "—"} 条</span>
        <span className="muted small">{autoRefresh ? index === 0 ? "第一页自动刷新中" : "已翻页；自动刷新暂不打断历史浏览" : "自动刷新已暂停"}</span>
      </div>
    </Panel>

    <Note>本页按数据库中每条已保存的 FAIL 判定记录展示，不自动把相邻记录合并成一个报警事件；未判定、无效值不会被本页提升为超限。正式事件生命周期和人工处置由后续 M05 工作包实现。</Note>

    <Drawer title="超限测量记录" open={!!selected} onClose={() => setSelected(null)}>
      {selected && <>
        <p><Badge tone="red">服务端判定超限</Badge> <strong>{selected.value ?? "—"} {selected.unit}</strong> · {names[selected.metric_code] || selected.metric_code}</p>
        <div className="detail-grid">
          <div className="meta-item"><span className="muted small">记录ID</span><div>{selected.id}</div></div>
          <div className="meta-item"><span className="muted small">线缆 / 工单 / 任务</span><div>{selected.business_context?.spool_code || selectedTask?.current_spool_code || selectedTask?.context_snapshot.spool_code || "盘号未关联"} / {selected.business_context?.external_code || selectedTask?.current_order_code || selectedTask?.context_snapshot.external_code || "工单未关联"} / {selected.business_context?.task_code || selectedTask?.task_code || selectedTaskId || "未关联任务"}</div></div>
          <div className="meta-item"><span className="muted small">检测设备</span><div>{selected.raw_payload.device_id}</div></div>
          <div className="meta-item"><span className="muted small">采样时间</span><div>{labelTime(selected.raw_payload.sample_time)}</div></div>
          <div className="meta-item"><span className="muted small">接收时间</span><div>{labelTime(selected.received_at)}</div></div>
          <div className="meta-item"><span className="muted small">规则快照</span><div>{selectedTask ? ruleText(selectedTask.rule_snapshot) : "任务快照不可用"}</div></div>
          <div className="meta-item"><span className="muted small">判定原因</span><div>{selected.evaluation_reason || "—"}</div></div>
          <div className="meta-item"><span className="muted small">数据来源 / 资格</span><div>{environmentLabel(selected.raw_payload.data_environment)} · {selected.eligibility} · {selected.receipt_status}</div></div>
          <div className="meta-item"><span className="muted small">来源米数</span><div>{selected.raw_payload.position_m == null ? "未知" : `${selected.raw_payload.position_m} m（未验证）`}</div></div>
        </div>
        {selected.quality_result === "FAIL" && <DefectExamples api={api} record={selected} task={selectedTask as Task | undefined} compact key={selected.id} failed={1} context={`记录 ${selected.id} · ${labelTime(selected.raw_payload.sample_time)}`} />}
        {selectedTaskId && <div className="row"><HashLink route={`task?id=${encodeURIComponent(selectedTaskId)}&back=${encodeURIComponent(currentRoute)}`}>查看关联任务</HashLink><HashLink route={`history?task_id=${encodeURIComponent(selectedTaskId)}&quality=FAIL&return_to=${encodeURIComponent(currentRoute)}`}>查看该任务超限历史</HashLink></div>}
        <details className="ux-technical"><summary>原始记录与内部字段</summary><pre className="b2-json">{JSON.stringify(selected.raw_payload, null, 2)}</pre></details>
      </>}
    </Drawer>
  </>;
}
