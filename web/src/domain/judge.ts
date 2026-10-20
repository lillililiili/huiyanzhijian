import { isMetricId, METRICS } from "./metrics";
import type { Judgement, RuleSnapshot, Validity } from "./types";
import { clean } from "./time";

export function judge(value: unknown, metric: string, rule?: RuleSnapshot | { operator: string; threshold: number }, validity?: Validity | string): Judgement {
  if (!isMetricId(metric)) throw new Error("仅支持搭盖率、铜丝间隙和不圆度三项检测");
  if (validity === "invalid" || value === null || value === undefined || clean(value) === "" || typeof value === "boolean" || !Number.isFinite(Number(value))) return "invalid";
  const current = rule || METRICS[metric];
  if (!["<=", ">="].includes(current.operator) || !Number.isFinite(Number(current.threshold))) return "invalid";
  return (current.operator === ">=" ? Number(value) >= Number(current.threshold) : Number(value) <= Number(current.threshold)) ? "pass" : "fail";
}
