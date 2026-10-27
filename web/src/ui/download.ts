import { METRICS } from "../domain/metrics";
import type { InspectionRecord } from "../domain/types";
import { date } from "./format";

const CSV_HEADERS = ["记录编号", "检测时间", "任务编号", "工单", "盘号", "检测项目", "米数", "实测值", "单位", "规则版本", "阈值", "数据有效性", "判定", "数据来源", "平台状态", "MES状态"];

export function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildRecordsCsv(records: readonly InspectionRecord[]): string {
  const rows = records.map(record => {
    const metric = METRICS[record.metric];
    return [
      record.id,
      date(record.time),
      record.taskId,
      record.workOrder,
      record.reelId,
      metric?.name,
      record.meter,
      record.value,
      metric?.unit,
      record.ruleSnapshot?.version,
      `${record.ruleSnapshot?.operator}${record.ruleSnapshot?.threshold}`,
      record.validity,
      record.judgement,
      record.source,
      record.platformStatus,
      record.mesStatus
    ];
  });
  return `\uFEFF${[CSV_HEADERS, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function downloadFile(name: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadRecords(records: readonly InspectionRecord[], filename = "慧眼智检-检测数据.csv") {
  downloadFile(filename, buildRecordsCsv(records), "text/csv;charset=utf-8");
}
