import { METRICS } from "./metrics";
import { timeAdd } from "./time";
import type { AppState, InspectionRecord, MetricDefinition, Task } from "./types";

export interface DetectionContext {
  task: Task | null;
  metric: MetricDefinition;
  records: InspectionRecord[];
  missing: boolean;
}

/** Unknown keys collapse to dg before a task is chosen. Breadcrumbs do not use this. */
export function metricOf(key: string | null | undefined): MetricDefinition {
  if (key === "dg" || key === "jx" || key === "by") return METRICS[key];
  return METRICS.dg;
}

export function detectionRows(records: readonly InspectionRecord[], task: Task | null): InspectionRecord[] {
  if (!task) return [];
  const rows = records.filter(record => record.taskId === task.id).slice().sort((a, b) => a.time.localeCompare(b.time));
  if (!rows.length) return [];
  const end = rows[rows.length - 1].time;
  const start = timeAdd(end, -29 * 60);
  return rows.filter(record => record.time >= start && record.time <= end);
}

export function detectionContext(state: AppState, params: URLSearchParams): DetectionContext {
  const requested = params.get("task");
  const fallbackMetric = metricOf(params.get("metric"));
  const sameMetric = state.tasks.filter(task => task.metric === fallbackMetric.id);
  const task = requested
    ? state.tasks.find(item => item.id === requested) ?? null
    : sameMetric.find(item => item.status === "running")
      ?? sameMetric.slice().sort((a, b) => String(b.startAt || b.createdAt || "").localeCompare(String(a.startAt || a.createdAt || "")))[0]
      ?? null;
  return {
    task,
    metric: task ? metricOf(task.metric) : fallbackMetric,
    records: detectionRows(state.records, task),
    missing: Boolean(requested) && !task
  };
}
