import { useSyncExternalStore } from "react";
import { detectionRows } from "../../domain/detectionWindow";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import { FilterForm, useViewFilters } from "../../ui/FilterForm";
import { Badge } from "../../ui/Badge";
import { DataTable } from "../../ui/DataTable";
import { Empty } from "../../ui/Empty";
import { Field, Select } from "../../ui/Field";
import { HashLink } from "../../ui/HashLink";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { metricFmt, ruleLabel } from "../../ui/format";
import { MetaItem, MetricHero, latestRecord, timeOnly } from "../present";

export function MonitorPage({ store }: { store: InspectionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const filters = useViewFilters("monitor");
  const display = state.settings.metricDisplay;
  const lines = Array.from(new Set(state.devices.map(device => device.line)));
  const devices = state.devices.filter(device => (
    (!filters.line || device.line === filters.line)
    && (!filters.metric || device.metric === filters.metric)
    && (!filters.status || device.status === filters.status)
  ));
  const online = state.devices.filter(device => device.status === "online").length;
  const offline = state.devices.length - online;
  const recent = store.currentRecords()
    .slice()
    .sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id))
    .filter(record => devices.some(device => device.id === record.deviceId))
    .slice(0, 6);

  return (
    <>
      <PageTitle
        title="产线与设备实时总览"
        subtitle="各工位独立检测；不同设备的检测对象与任务分别关联。"
        actions={<Badge tone="green">{online} 台在线 · {offline} 台离线</Badge>}
      />
      <FilterForm id="monitor">
        {current => (
          <>
            <Field label="产线">
              <Select name="line" value={current.line || ""} options={[["", "全部产线"], ...lines.map(line => [line, line] as const)]} />
            </Field>
            <Field label="设备类型">
              <Select
                name="metric"
                value={current.metric || ""}
                options={[["", "全部三类设备"], ...Object.values(METRICS).map(metric => [metric.id, metric.name] as const)]}
              />
            </Field>
            <Field label="连接状态">
              <Select name="status" value={current.status || ""} options={[["", "全部状态"], ["online", "在线"], ["offline", "离线"]]} />
            </Field>
          </>
        )}
      </FilterForm>
      <div className="grid cols-3">
        {devices.length ? devices.map(device => {
          const metric = METRICS[device.metric];
          const task = state.tasks.find(item => item.deviceId === device.id && item.status === "running");
          const last = latestRecord(detectionRows(state.records, task ?? null));
          const spec = task ? state.specs.find(item => item.id === task.specId) : undefined;
          const href = task ? `detection?metric=${device.metric}&task=${encodeURIComponent(task.id)}` : `detection?metric=${device.metric}`;
          return (
            <Panel
              key={device.id}
              core
              className="monitor-card"
              title={metric.name}
              tools={<>
                <StatusBadge value={device.status} />
                {" "}
                <HashLink route={href}>进入检测 ›</HashLink>
              </>}
            >
              <div className="device-visual">
                <img src={`assets/images/device-${device.metric}.png`} alt={device.name} />
                <div>
                  <p className="muted small">当前量测值</p>
                  <MetricHero value={metricFmt(last?.value, device.metric, display)} unit={metric.unit} />
                  {last ? <StatusBadge value={last.judgement} /> : <Badge tone="gray">暂无数据</Badge>}
                  <p className="muted small">{ruleLabel(metric, last?.ruleSnapshot)}</p>
                </div>
              </div>
              <div className="detail-grid">
                <MetaItem label="设备编号">{device.id}</MetaItem>
                <MetaItem label="电压等级">{task && spec ? `${spec.voltage}kV` : "—"}</MetaItem>
                <MetaItem label="当前盘号">{task ? <HashLink route={`trace?reel=${encodeURIComponent(task.reelId)}`}>{task.reelId}</HashLink> : "—"}</MetaItem>
                <MetaItem label="任务状态">{task ? <StatusBadge value={task.status} kind="task" /> : <Badge tone="gray">空闲</Badge>}</MetaItem>
              </div>
            </Panel>
          );
        }) : <Empty text="没有匹配的设备" />}
      </div>
      <Panel
        core
        table
        title="最近数据更新"
        tools={<span className="muted small">当前 {devices.length} 台设备 · {recent.length} 条最新记录</span>}
      >
        <DataTable
          headers={["更新时间", "设备编号", "检测项目", "盘号", "实测值", "数据有效性", "MES状态"]}
          rows={recent.map(record => {
            const metric = METRICS[record.metric];
            const task = state.tasks.find(item => item.id === record.taskId);
            const href = task ? `detection?metric=${record.metric}&task=${encodeURIComponent(task.id)}` : `detection?metric=${record.metric}`;
            return [
              timeOnly(record.time),
              record.deviceId,
              <HashLink route={href}>{metric.name}</HashLink>,
              <HashLink route={`trace?reel=${encodeURIComponent(record.reelId)}`}>{record.reelId}</HashLink>,
              `${metricFmt(record.value, record.metric, display)} ${metric.unit}`,
              <StatusBadge value={record.validity} />,
              <StatusBadge value={record.mesStatus} />
            ];
          })}
        />
      </Panel>
      <p className="muted small">设备外形参考产品手册；此图不表示三款设备安装在同一条产线上。</p>
    </>
  );
}
