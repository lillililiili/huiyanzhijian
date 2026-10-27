import type { MetricDefinition, MetricId } from "./types";

export const METRICS: Record<MetricId, MetricDefinition> = {
  dg: { id: "dg", name: "金属屏蔽搭盖率", short: "搭盖率", unit: "%", threshold: 10, operator: ">=", color: "#155ab6", icon: "layers-intersect", image: "assets/images/copper-inspection.png" },
  jx: { id: "jx", name: "铜丝屏蔽相邻铜丝间隙", short: "铜丝间隙", unit: "mm", threshold: 3, operator: "<=", color: "#1289ad", icon: "ruler-measure", image: "assets/images/wire-inspection.png" },
  by: { id: "by", name: "电缆不圆度", short: "不圆度", unit: "%", threshold: 8, operator: "<=", color: "#079981", icon: "circle-dashed", image: "assets/images/roundness.png" }
};

export function isMetricId(value: string): value is MetricId {
  return value === "dg" || value === "jx" || value === "by";
}
