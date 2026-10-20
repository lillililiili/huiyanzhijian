import { Badge, type BadgeTone } from "./Badge";

export type StatusKind = "generic" | "task" | "alarm" | "mes";

const generic: Record<string, [string, BadgeTone]> = {
  pending: ["待处理", "amber"],
  running: ["检测中", "blue"],
  completed: ["已完成", "green"],
  pass: ["符合阈值", "green"],
  fail: ["超限", "red"],
  invalid: ["无有效数据", "gray"],
  valid: ["有效数据", "blue"],
  online: ["在线", "green"],
  offline: ["离线", "gray"],
  received: ["已接收", "blue"],
  confirmed: ["已确认", "green"],
  failed: ["同步失败", "red"],
  processing: ["处理中", "blue"],
  resolved: ["已处理", "green"],
  enabled: ["启用", "green"],
  disabled: ["停用", "gray"],
  stage: ["阶段报告", "blue"],
  final: ["最终报告", "green"],
  admin: ["系统管理员", "blue"],
  quality: ["质量管理员", "green"],
  viewer: ["只读查看者", "gray"]
};

const task: Record<string, [string, BadgeTone]> = {
  pending: ["待开始", "gray"],
  running: ["检测中", "blue"],
  completed: ["已完成", "green"]
};

const alarm: Record<string, [string, BadgeTone]> = {
  pending: ["待复核", "red"],
  processing: ["处理中", "amber"],
  resolved: ["已处理", "green"]
};

const mes: Record<string, [string, BadgeTone]> = {
  confirmed: ["已确认", "green"],
  pending: ["待同步", "blue"],
  failed: ["同步失败", "red"]
};

const tables = { generic, task, alarm, mes };

export function statusPair(value: string, kind: StatusKind = "generic"): [string, BadgeTone] {
  const table = tables[kind];
  if (kind === "task") return table[value] ?? generic[value] ?? [value || "—", "gray"];
  return table[value] ?? [value || "—", "gray"];
}

export function StatusBadge({ value, kind = "generic" }: { value: string; kind?: StatusKind }) {
  const [text, tone] = statusPair(value, kind);
  return <Badge tone={tone}>{text}</Badge>;
}
