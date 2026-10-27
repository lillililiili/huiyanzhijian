import { METRICS } from "../domain/metrics";
import type { InspectionRecord } from "../domain/types";
import { Button } from "./Button";
import { DataTable } from "./DataTable";
import { HashLink } from "./HashLink";
import { StatusBadge } from "./StatusBadge";
import { date, fmt } from "./format";

export function RecordTable({ records, onView }: { records: InspectionRecord[]; onView: (id: string) => void }) {
  const rows = records.map(record => {
    const metric = METRICS[record.metric];
    const operator = record.ruleSnapshot?.operator || metric.operator;
    const threshold = record.ruleSnapshot?.threshold ?? metric.threshold;
    return [
      <HashLink route={`history?record=${encodeURIComponent(record.id)}`}>{date(record.time).slice(-8)}</HashLink>,
      <HashLink route={`trace?reel=${encodeURIComponent(record.reelId)}`}>{record.reelId}</HashLink>,
      metric.name,
      `${fmt(record.value)} ${metric.unit}`,
      `${operator} ${threshold}${metric.unit}`,
      <StatusBadge value={record.judgement} />,
      <StatusBadge value={record.mesStatus} />,
      <Button icon="eye" onClick={() => onView(record.id)}>查看</Button>
    ];
  });
  return (
    <DataTable
      headers={["时间", "盘号", "检测项目", "实测值", "当时判定规则", "数值判定", "MES状态", "操作"]}
      rows={rows}
    />
  );
}
