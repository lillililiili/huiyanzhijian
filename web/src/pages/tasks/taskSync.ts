import type { BadgeTone } from "../../ui/Badge";
import type { InspectionRecord, Task } from "../../domain/types";

/** Task-list MES summary. It is not the record-level mesState vocabulary. */
export function taskSyncLabel(task: Task, records: readonly InspectionRecord[]): { text: string; tone: BadgeTone } {
  const rows = records.filter(record => record.taskId === task.id);
  if (!rows.length) return { text: "待采集", tone: "gray" };
  if (rows.some(record => record.mesStatus === "failed")) return { text: "同步失败", tone: "red" };
  if (rows.some(record => record.mesStatus !== "confirmed")) return { text: "同步中", tone: "blue" };
  if (task.status === "running") return { text: "同步中", tone: "blue" };
  return { text: "已确认", tone: "green" };
}
