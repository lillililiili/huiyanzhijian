import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { trendOption, trendRows, type TrendAxis } from "../charts/trendOption";
import type { InspectionRecord, MetricDefinition } from "../domain/types";

function chartRenderer(): "canvas" | "svg" {
  try {
    const canvas = document.createElement("canvas");
    if (canvas.getContext("2d")) return "canvas";
  } catch {
    return "svg";
  }
  return "svg";
}

export function TrendChart({
  metric,
  records,
  axis = "time",
  height = 260,
  onPoint
}: {
  metric: MetricDefinition;
  records: readonly InspectionRecord[];
  axis?: TrendAxis;
  height?: number;
  onPoint?: (record: InspectionRecord) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let chart: echarts.ECharts | undefined;
    const resize = () => chart?.resize();
    try {
      const rows = trendRows(records, metric.id);
      chart = echarts.init(element, undefined, { renderer: chartRenderer() });
      chart.setOption(trendOption(metric, records, axis) as unknown as echarts.EChartsCoreOption);
      chart.on("click", (raw: unknown) => {
        const params = raw as { seriesIndex?: number; dataIndex?: number };
        if (params.seriesIndex !== 0 || typeof params.dataIndex !== "number") return;
        const record = rows[params.dataIndex];
        if (record) onPointRef.current?.(record);
      });
      window.addEventListener("resize", resize);
    } catch (error) {
      console.error(error);
      try {
        chart?.dispose();
      } catch {
        chart = undefined;
      }
      chart = undefined;
      element.textContent = "图表不可用";
    }
    return () => {
      window.removeEventListener("resize", resize);
      try {
        chart?.dispose();
      } catch {
        chart = undefined;
      }
    };
  }, [axis, metric, records]);

  return (
    <div
      ref={host}
      className="chart-host"
      style={{ height }}
      role="img"
      aria-label={`${metric.name}趋势，可点击数据点查看原始记录`}
    />
  );
}
