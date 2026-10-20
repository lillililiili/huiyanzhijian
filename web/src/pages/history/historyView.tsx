import { METRICS } from "../../domain/metrics";
import type { InspectionRecord, MetricId, Spec, Task } from "../../domain/types";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { HashLink } from "../../ui/HashLink";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { TrendChart } from "../../ui/TrendChart";
import { metricFmt, ruleLabel } from "../../ui/format";
import { latestRecord, timeOnly } from "../present";

export function MetricMiniCard({
  metricId,
  records
}: {
  metricId: MetricId;
  records: readonly InspectionRecord[];
}) {
  const metric = METRICS[metricId];
  const last = latestRecord(records);
  const href = last
    ? `detection?metric=${metricId}&task=${encodeURIComponent(last.taskId)}`
    : `detection?metric=${metricId}`;
  return (
    <Panel core className="metric-panel" title={metric.name} tools={<HashLink route={href}>查看检测 ›</HashLink>}>
      <TrendChart metric={metric} records={records} height={150} />
    </Panel>
  );
}

export function HistoryRecordTable({
  records,
  tasks,
  specs,
  display,
  onView
}: {
  records: readonly InspectionRecord[];
  tasks: readonly Task[];
  specs: readonly Spec[];
  display?: unknown;
  onView: (id: string) => void;
}) {
  return (
    <DataTable
      headers={["时间", "盘号", "电压等级", "检测项目", "实测值", "当时判定阈值", "数值判定", "数据来源", "MES状态", "操作"]}
      rows={records.map(record => {
        const metric = METRICS[record.metric];
        const task = tasks.find(item => item.id === record.taskId);
        const spec = task ? specs.find(item => item.id === task.specId) : undefined;
        const value = record.validity === "valid" ? `${metricFmt(record.value, record.metric, display)} ${metric.unit}` : "—";
        return [
          timeOnly(record.time),
          <HashLink key={record.id} route={`trace?reel=${encodeURIComponent(record.reelId)}`}>{record.reelId}</HashLink>,
          spec ? `${spec.voltage}kV` : "—",
          metric.name,
          value,
          ruleLabel(metric, record.ruleSnapshot),
          <StatusBadge value={record.judgement} />,
          record.source || "设备自动采集",
          <StatusBadge value={record.mesStatus} />,
          <Button onClick={() => onView(record.id)}>查看</Button>
        ];
      })}
    />
  );
}
