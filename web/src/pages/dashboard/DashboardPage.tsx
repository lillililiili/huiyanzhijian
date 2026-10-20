import { useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import type { InspectionStore } from "../../domain/store";
import { detectionRows } from "../../domain/detectionWindow";
import { METRICS } from "../../domain/metrics";
import type { MetricId, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { DataTable } from "../../ui/DataTable";
import { HashLink } from "../../ui/HashLink";
import { Icon } from "../../ui/Icon";
import { Kpi } from "../../ui/Kpi";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { RecordDrawer } from "../../ui/RecordDrawer";
import { StatusBadge } from "../../ui/StatusBadge";
import { TrendChart } from "../../ui/TrendChart";
import { fmt, metricFmt, ruleLabel } from "../../ui/format";
import { MetricHero, latestRecord, specLabel, timeOnly } from "../present";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];

export function DashboardPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [recordId, setRecordId] = useState<string | null>(null);
  const display = state.settings.metricDisplay;
  const windowRows = useMemo(() => store.currentRecords(), [state, store]);
  const summary = store.stats(windowRows);
  const running = state.tasks.filter(task => task.status === "running");
  const unresolved = state.alarms.filter(alarm => alarm.status !== "resolved");
  const taskAlarms = state.alarms.filter(alarm => running.some(task => task.id === alarm.taskId));
  const online = state.devices.filter(device => device.status === "online").length;
  const received = windowRows.filter(record => record.platformStatus === "received").length;
  const synced = windowRows.filter(record => record.mesStatus === "confirmed").length;
  const newest = latestRecord(windowRows);
  const percent = summary.total ? fmt(synced / summary.total * 100, 0) : "0";

  return (
    <>
      <PageTitle
        title="工作台首页"
        subtitle="35–220kV高压电缆 · 三项检测运行概况与待办事项"
        actions={<Badge tone="blue">数据更新 {timeOnly(newest?.time)}</Badge>}
      />
      <div className="grid cols-5">
        <Kpi label="今日检测任务" value={state.tasks.length} note={`检测中 ${running.length} · 已完成 ${state.tasks.filter(task => task.status === "completed").length}`} icon="clipboard" />
        <Kpi label="在线检测设备" value={<>{online} <small>/ {state.devices.length}</small></>} note="三款设备连接状态" icon="monitor" tone="green" />
        <Kpi label="当前任务超限事件" value={taskAlarms.length} note="原始超限记录持续保留" icon="bell" tone="red" />
        <Kpi label="待复核事件" value={unresolved.length} note="恢复正常后仍需人工复核" icon="shield" tone="amber" />
        <Kpi label="MES记录同步" value={<>{percent} <small>%</small></>} note={`当前窗口 ${synced} / ${summary.total} 条`} icon="cloud-upload" />
      </div>
      <div className="grid cols-3">
        {METRIC_ORDER.map(key => {
          const metric = METRICS[key];
          const task = running.find(item => item.metric === key);
          const rows = task ? detectionRows(state.records, task) : windowRows.filter(record => record.metric === key);
          const last = latestRecord(rows);
          const cardStats = store.stats(rows);
          const href = last ? `detection?metric=${key}&task=${encodeURIComponent(last.taskId)}` : `detection?metric=${key}`;
          return (
            <Panel
              key={key}
              core
              className="metric-panel"
              title={metric.name}
              tools={<HashLink route={href}>查看检测 ›</HashLink>}
            >
              <div className="row core-metric-summary">
                <div>
                  <MetricHero value={metricFmt(last?.value, key, display)} unit={metric.unit} />
                  <div className="muted small">{metric.short || metric.name} {ruleLabel(metric, last?.ruleSnapshot)}</div>
                </div>
                <div className="spacer" />
                <div className="stack" style={{ gap: 10, alignItems: "flex-end" }}>
                  {last ? <StatusBadge value={last.judgement} /> : <Badge tone="gray">暂无数据</Badge>}
                  <span className="muted small">{last?.deviceId || "—"} · {cardStats.valid} 条有效记录</span>
                </div>
              </div>
              <TrendChart metric={metric} records={rows} height={215} onPoint={record => setRecordId(record.id)} />
            </Panel>
          );
        })}
      </div>
      <div className="split">
        <Panel
          core
          table
          title="当前检测任务"
          tools={<HashLink route="tasks">全部任务 →</HashLink>}
        >
          <DataTable
            headers={["任务编号", "检测项目", "规格", "盘号", "任务状态", "操作"]}
            rows={running.slice(0, 4).map(task => {
              const spec = state.specs.find(item => item.id === task.specId);
              return [
                <HashLink route={`task?id=${encodeURIComponent(task.id)}`}>{task.id}</HashLink>,
                METRICS[task.metric].name,
                specLabel(spec),
                <HashLink route={`trace?reel=${encodeURIComponent(task.reelId)}`}>{task.reelId}</HashLink>,
                <StatusBadge value={task.status} kind="task" />,
                <HashLink route={`detection?metric=${task.metric}&task=${encodeURIComponent(task.id)}`}>进入检测</HashLink>
              ];
            })}
          />
        </Panel>
        <Panel core title="待办与同步状态" tools={<HashLink route="alarms">查看报警</HashLink>}>
          {unresolved.length ? unresolved.slice(0, 2).map(alarm => {
            const record = state.records.find(item => item.id === alarm.recordId);
            const metric = METRICS[alarm.metric];
            return (
              <div className="todo-item row" key={alarm.id}>
                <div className="stat-icon red"><Icon name="bell" /></div>
                <div className="stack" style={{ gap: 6 }}>
                  <strong>
                    <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>
                      {metric.short}{alarm.metric === "dg" ? "低于控制下限" : "超过控制上限"}
                    </HashLink>
                  </strong>
                  <span className="muted small">{record?.reelId || ""} · {timeOnly(alarm.createdAt)} · {metricFmt(record?.value, alarm.metric, display)} {metric.unit}</span>
                </div>
                <div className="spacer" />
                <StatusBadge value={alarm.status} />
              </div>
            );
          }) : (
            <div className="todo-item row">
              <div className="stat-icon green"><Icon name="shield-check" /></div>
              <strong>当前没有待复核事件</strong>
              <Badge tone="green">已处理</Badge>
            </div>
          )}
          <div className="key-value"><span>已处理超限事件</span><span>{state.alarms.filter(alarm => alarm.status === "resolved").length} 项</span></div>
          <div className="key-value"><span>平台接收当前窗口记录</span><span>{received} / {summary.total} 条</span></div>
          <div className="key-value"><span>MES确认接收记录</span><span className="text-green">{synced} / {summary.total} 条</span></div>
          <p className="muted small">检测状态、数据判定和 MES 接收状态分别记录。</p>
        </Panel>
      </div>
      <Note>当前值符合阈值不代表整盘最终合格；过程超限保留原始记录，完成复核后形成质量结论。</Note>
      <RecordDrawer store={store} user={user} recordId={recordId} open={Boolean(recordId)} onClose={() => setRecordId(null)} />
    </>
  );
}
