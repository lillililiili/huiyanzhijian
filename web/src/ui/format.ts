const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
};

/** Tooltip and other HTML strings. React text nodes do not need this. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => HTML_ESCAPES[char] ?? char);
}

export function fmt(value: unknown, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function metricDecimals(display: unknown, metricId: string): number {
  if (!display || typeof display !== "object") return 2;
  const row = (display as Record<string, unknown>)[metricId];
  if (!row || typeof row !== "object") return 2;
  const digits = (row as { decimals?: unknown }).decimals;
  if (typeof digits !== "number" || !Number.isInteger(digits) || digits < 0 || digits > 20) return 2;
  return digits;
}

export function metricFmt(value: unknown, metricId: string, display?: unknown): string {
  return fmt(value, metricDecimals(display, metricId));
}

/** Threshold text keeps the stored number. It must not reuse metricFmt. */
export function thresholdText(value: unknown): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return String(Number(value));
}

export function ruleLabel(
  metric: { operator?: string; unit: string; threshold?: number },
  rule?: { operator?: string; threshold?: number } | null
): string {
  const source = rule ?? metric;
  const operator = source.operator === ">=" ? "≥" : "≤";
  return `${operator} ${thresholdText(source.threshold)} ${metric.unit}`;
}

export function date(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, "");
}
