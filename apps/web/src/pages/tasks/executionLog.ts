import type { AppState, Task } from "../../domain/types";
import { METRICS } from "../../domain/metrics";
import { timeAdd } from "../../domain/time";
import { date, metricFmt } from "../../ui/format";

export interface ExecutionEvent {
  time: string;
  text: string;
  actor: string;
}

/** Rebuild one task's log. Seed ids dated T20261009 assign five minutes before start. */
export function executionEvents(state: AppState, task: Task): ExecutionEvent[] {
  const events: ExecutionEvent[] = [];
  const metric = METRICS[task.metric];
  function add(time: string | null | undefined, text: string, actor = "系统") {
    if (time) events.push({ time: date(time), text, actor });
  }
  add(task.createdAt || task.startAt, "创建检测任务", "质量管理员");
  const assigned = task.assignedAt
    || (/^T20261009\d{3}$/.test(task.id) && task.startAt ? timeAdd(task.startAt, -5 * 60) : task.createdAt);
  add(assigned, "关联设备与检测配方", "质量管理员");
  add(task.startAt, "开始采集量测数据", task.deviceId);
  state.alarms.filter(alarm => alarm.taskId === task.id).forEach(alarm => {
    const record = state.records.find(item => item.id === alarm.recordId);
    add(alarm.createdAt, `记录${metric.short}超限：${metricFmt(record?.value, alarm.metric, state.settings.metricDisplay)} ${metric.unit}`);
    alarm.history.filter(entry => entry.time !== alarm.createdAt).forEach(entry => {
      add(entry.time, entry.note, entry.actor || "系统");
    });
  });
  state.audits.filter(audit => String(audit.detail || "").includes(task.id) && /采集|补录|导入|重试|修改/.test(audit.action)).forEach(audit => {
    add(audit.time, audit.action, audit.actor || "质量管理员");
  });
  const confirmed = state.records
    .filter(record => record.taskId === task.id && record.mesStatus === "confirmed")
    .sort((a, b) => String(b.confirmedAt || b.time).localeCompare(String(a.confirmedAt || a.time)))[0];
  if (confirmed) add(confirmed.confirmedAt || confirmed.time, "MES确认接收最新记录");
  add(task.endAt, "完成本次检测", task.deviceId);
  const unique = Array.from(new Map(events.map(event => [`${event.time}|${event.text}|${event.actor}`, event])).values());
  unique.sort((a, b) => a.time.localeCompare(b.time));
  return unique;
}
