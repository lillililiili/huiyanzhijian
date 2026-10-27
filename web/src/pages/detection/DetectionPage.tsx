import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { detectionContext } from "../../domain/detectionWindow";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, SessionUser } from "../../domain/types";
import { setFilters } from "../../app/viewState";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Empty } from "../../ui/Empty";
import { useViewFilters } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Icon } from "../../ui/Icon";
import { InspectionFigure } from "../../ui/InspectionFigure";
import { Kpi } from "../../ui/Kpi";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { RecordDrawer } from "../../ui/RecordDrawer";
import { StatusBadge } from "../../ui/StatusBadge";
import { TrendChart } from "../../ui/TrendChart";
import { toast } from "../../ui/Toast";
import { fmt, metricFmt, ruleLabel } from "../../ui/format";
import { MetaItem, ValueWithUnit, latestRecord, specLabel, timeOnly } from "../present";

interface Playback {
  cursor: number;
  playing: boolean;
  timer: number;
}

const playback = new Map<string, Playback>();

const COPY: Record<MetricId, { current: string; trend: string; figure: string; subtitle: string }> = {
  dg: {
    current: "当前搭盖率",
    trend: "搭盖率实时趋势",
    figure: "铜带搭盖率量测示意",
    subtitle: "金属屏蔽搭盖率实时量测、过程趋势与质量追溯"
  },
  jx: {
    current: "当前平均间隙",
    trend: "平均间隙实时趋势",
    figure: "相邻铜丝间隙量测示意",
    subtitle: "铜丝屏蔽相邻铜丝间隙实时量测与平均统计"
  },
  by: {
    current: "当前不圆度",
    trend: "不圆度实时趋势",
    figure: "双向测径示意",
    subtitle: "不圆度结果展示；外径为本项检测的辅助数据"
  }
};

export function resetDetectionPlayback() {
  for (const play of playback.values()) window.clearInterval(play.timer);
  playback.clear();
}

function stopPlayback(taskId: string) {
  const play = playback.get(taskId);
  if (!play) return;
  window.clearInterval(play.timer);
  play.playing = false;
}

export function DetectionPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [clock, setClock] = useState(0);
  const [recordId, setRecordId] = useState<string | null>(null);
  const context = detectionContext(state, params);
  const taskId = context.task?.id;
  const filters = useViewFilters(`axis-${context.metric.id}`);

  useEffect(() => {
    return () => {
      if (taskId) stopPlayback(taskId);
    };
  }, [taskId]);

  if (context.missing) {
    return (
      <>
        <PageTitle title="检测任务不存在" subtitle="请从检测任务列表选择有效任务。" actions={<HashLink route="tasks">返回任务列表</HashLink>} />
        <Empty text="未找到指定检测任务" />
      </>
    );
  }

  const metric = context.metric;
  const copy = COPY[metric.id];
  const axis = filters.axis === "meter" ? "meter" : "time";
  const play = taskId ? playback.get(taskId) : undefined;
  const playbackCursor = clock >= 0 ? play?.cursor ?? 0 : 0;
  const rows = playbackCursor ? context.records.slice(0, playbackCursor) : context.records;
  const last = latestRecord(rows);
  const summary = store.stats(rows);
  const display = state.settings.metricDisplay;
  const device = context.task ? state.devices.find(item => item.id === context.task?.deviceId) : undefined;
  const spec = context.task ? state.specs.find(item => item.id === context.task?.specId) : undefined;
  const rule = last?.ruleSnapshot || context.task?.ruleSnapshot || metric;
  const alarms = state.alarms.filter(alarm => alarm.taskId === taskId);
  const confirmed = latestRecord(rows.filter(record => record.mesStatus === "confirmed"));
  const currentNote = last?.judgement === "pass" ? "当前值符合阈值" : last?.judgement === "fail" ? "当前值超出阈值" : "等待有效记录";

  function bump() {
    setClock(value => value + 1);
  }

  function replay() {
    if (!taskId || context.task?.id !== taskId || !context.records.length) {
      toast("该任务暂无可回放的量测记录");
      return;
    }
    const current = playback.get(taskId) ?? { cursor: 1, playing: false, timer: 0 };
    playback.set(taskId, current);
    if (current.playing) {
      stopPlayback(taskId);
      bump();
      return;
    }
    if (current.cursor >= context.records.length) current.cursor = 1;
    current.playing = true;
    const delay = Math.max(1, Number(state.settings.refreshInterval) || 5) * 1000;
    current.timer = window.setInterval(() => {
      const hash = window.location.hash.replace(/^#/, "");
      const route = hash.split("?")[0];
      const liveParams = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
      const live = detectionContext(store.getState(), liveParams);
      if (route !== "detection" || live.task?.id !== taskId) {
        stopPlayback(taskId);
        bump();
        return;
      }
      current.cursor += 1;
      if (current.cursor >= live.records.length) stopPlayback(taskId);
      bump();
    }, delay);
    bump();
  }

  function live() {
    if (!taskId) return;
    const current = playback.get(taskId);
    if (current) window.clearInterval(current.timer);
    playback.delete(taskId);
    bump();
  }

  return (
    <>
      <PageTitle
        title={`${metric.name}检测`}
        subtitle={copy.subtitle}
        actions={device?.status === "online"
          ? <Badge tone="green">设备在线 · {last?.validity === "valid" ? "数据有效" : "等待数据"}</Badge>
          : <Badge tone="gray">设备离线</Badge>}
      />
      <div className="metrics-strip core-metadata">
        <MetaItem label="执行设备">{context.task?.deviceId || "—"}</MetaItem>
        <MetaItem label="任务编号">{context.task ? <HashLink route={`task?id=${encodeURIComponent(context.task.id)}`}>{context.task.id}</HashLink> : "—"}</MetaItem>
        <MetaItem label="工单号">{context.task?.workOrder || "—"}</MetaItem>
        <MetaItem label="当前盘号">{context.task ? <HashLink route={`trace?reel=${encodeURIComponent(context.task.reelId)}`}>{context.task.reelId}</HashLink> : "—"}</MetaItem>
        <MetaItem label="高压电缆规格">{specLabel(spec)}</MetaItem>
        <MetaItem label="数据时间">{timeOnly(last?.time)}</MetaItem>
      </div>
      <div className="grid cols-5">
        <Kpi label={copy.current} value={<ValueWithUnit value={metricFmt(last?.value, metric.id, display)} unit={metric.unit} spaced />} note={currentNote} icon="target" />
        <Kpi label="本窗口最小值" value={<ValueWithUnit value={metricFmt(summary.min, metric.id, display)} unit={metric.unit} spaced />} note="按当前有效数据统计" icon="chart-line" tone="green" />
        <Kpi label="本窗口最大值" value={<ValueWithUnit value={metricFmt(summary.max, metric.id, display)} unit={metric.unit} spaced />} note={`${summary.valid} 条有效量测记录`} icon="chart-line" />
        <Kpi label="本窗口平均值" value={<ValueWithUnit value={metricFmt(summary.avg, metric.id, display)} unit={metric.unit} spaced />} note="无效记录不参与统计" icon="database" />
        <Kpi label="控制阈值" value={ruleLabel(metric, rule)} note="按任务关联的演示规则" icon="shield-check" tone="green" />
      </div>
      <div className="split">
        <Panel
          core
          title={copy.trend}
          tools={
            <div className="toolbar">
              <Button primary={axis !== "meter"} onClick={() => setFilters(`axis-${metric.id}`, { axis: "time" })}>最近30分钟</Button>
              <Button primary={axis === "meter"} onClick={() => setFilters(`axis-${metric.id}`, { axis: "meter" })}>按米数</Button>
              {context.records.length ? (
                <Button icon={play?.playing ? "pause" : "player-play"} onClick={replay}>
                  {play?.playing ? "暂停回放" : playbackCursor ? "继续回放" : "检测回放"}
                </Button>
              ) : null}
              {playbackCursor ? <Button onClick={live}>回到当前</Button> : null}
            </div>
          }
        >
          <TrendChart metric={METRICS[metric.id]} records={rows} axis={axis} height={290} onPoint={record => setRecordId(record.id)} />
        </Panel>
        <Panel core title={copy.figure} tools={<span className="muted small">非现场图像</span>}>
          {last ? <InspectionFigure record={last} /> : <Empty text="暂无量测记录" />}
        </Panel>
      </div>
      <div className="split">
        <Panel
          core
          table
          title="检测明细记录"
          tools={<HashLink route={`history?metric=${metric.id}`}>历史数据 →</HashLink>}
        >
          {rows.length ? (
            <DataTable
              headers={["时间", "米数位置 / m", "实测值", "当时判定规则", "数值判定", "MES状态", "操作"]}
              rows={rows.slice().sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id)).slice(0, 4).map(record => [
                timeOnly(record.time),
                fmt(record.meter, 1),
                record.validity === "valid" ? `${metricFmt(record.value, record.metric, display)} ${metric.unit}` : "—",
                ruleLabel(metric, record.ruleSnapshot),
                <StatusBadge value={record.judgement} />,
                <StatusBadge value={record.mesStatus} />,
                <Button onClick={() => setRecordId(record.id)}>查看</Button>
              ])}
            />
          ) : <Empty text="当前条件下没有检测记录" />}
        </Panel>
        <Panel core title="报警与同步状态">
          {alarms.length ? alarms.map(alarm => {
            const record = state.records.find(item => item.id === alarm.recordId);
            return (
              <div className="alarm-summary" key={alarm.id}>
                <div className="row">
                  <strong>
                    <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>
                      {timeOnly(alarm.createdAt)} · {metric.short}{metric.id === "dg" ? "低于下限" : "超过上限"}
                    </HashLink>
                  </strong>
                  <div className="spacer" />
                  <StatusBadge value={alarm.status} />
                </div>
                <p className="muted small">{fmt(record?.meter, 1)} m · 实测 {metricFmt(record?.value, metric.id, display)} {metric.unit} · {ruleLabel(metric, record?.ruleSnapshot)}</p>
              </div>
            );
          }) : (
            <div className="row todo-item">
              <div className="stat-icon green"><Icon name="shield-check" /></div>
              <div>
                <strong>本窗口无{metric.short}超限事件</strong>
                <p className="muted small">{summary.valid} 条有效记录 · {ruleLabel(metric, rule)}</p>
              </div>
            </div>
          )}
          <div className="key-value"><span>原始超限记录</span><span>保留，不覆盖</span></div>
          <div className="key-value"><span>最近 MES 确认</span><span>{timeOnly(confirmed?.time)}</span></div>
        </Panel>
      </div>
      <RecordDrawer store={store} user={user} recordId={recordId} open={Boolean(recordId)} onClose={() => setRecordId(null)} />
    </>
  );
}
