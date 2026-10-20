import type { InspectionRecord, MetricDefinition } from "../domain/types";
import { date, escapeHtml, fmt } from "../ui/format";

export type TrendAxis = "time" | "meter";

export interface TrendPoint {
  value: number | null;
  itemStyle: { color: string };
  symbolSize: number;
}

export interface TrendMarkLine {
  silent: true;
  symbol: "none";
  lineStyle: { color: "#e55c6c"; type: "dashed" };
  label: {
    position: "insideEndTop";
    color: "#cb4555";
    fontSize: 11;
    formatter: string;
    backgroundColor: "#fff5f6";
    padding: 5;
  };
  data: Array<{ yAxis: number }>;
}

export interface TrendSeries {
  type: "line";
  name?: string;
  data: TrendPoint[] | number[];
  connectNulls?: false;
  smooth?: false;
  showSymbol?: true;
  symbol?: "circle" | "none";
  lineStyle?: { width: number; color: string; type?: "dashed" };
  itemStyle?: { color: string; borderColor: "#fff"; borderWidth: 1.5 };
  areaStyle?: { color: string; opacity: 0.075 };
  markLine?: TrendMarkLine;
  step?: "end";
  tooltip?: { show: true };
}

export interface TrendOption {
  animation: false;
  grid: { top: 26; right: 30; bottom: 30; left: 48 };
  tooltip: {
    trigger: "axis";
    backgroundColor: "#fff";
    borderColor: "#e7edf5";
    textStyle: { color: "#263650" };
    formatter: (params: unknown) => string;
  };
  xAxis: {
    type: "category";
    data: string[];
    boundaryGap: false;
    axisLine: { lineStyle: { color: "#e7edf5" } };
    axisTick: { show: false };
    axisLabel: {
      color: "#8291a8";
      fontSize: 11;
      hideOverlap: true;
      showMaxLabel: true;
      interval: (index: number) => boolean;
    };
  };
  yAxis: {
    type: "value";
    name: string;
    min: number;
    max: number;
    interval: number;
    splitNumber: 4;
    axisLabel: { color: "#8291a8"; fontSize: 11 };
    splitLine: { lineStyle: { color: "#edf1f7" } };
    nameTextStyle: { color: "#8291a8"; padding: [number, number, number, number] };
  };
  series: TrendSeries[];
}

export function trendRows(records: readonly InspectionRecord[], metricId: string): InspectionRecord[] {
  return records.filter(record => record.metric === metricId).slice().sort((left, right) => left.time.localeCompare(right.time));
}

function tickIndexes(count: number): number[] {
  if (count <= 0) return [];
  const last = count - 1;
  return [0, Math.round(last * 0.24), Math.round(last * 0.48), Math.round(last * 0.72), last];
}

export function trendOption(metric: MetricDefinition, records: readonly InspectionRecord[], axis: TrendAxis = "time"): TrendOption {
  const rows = trendRows(records, metric.id);
  const values = rows.map(record => (record.validity === "valid" ? record.value : null));
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  const threshold = rows[0]?.ruleSnapshot?.threshold ?? metric.threshold;
  const thresholds = rows.map(record => record.ruleSnapshot?.threshold ?? metric.threshold);
  const mixed = new Set(thresholds).size > 1;
  const limits = metric.id === "dg" ? [8, 16] : metric.id === "jx" ? [0, 4] : [0, 10];
  const ticks = tickIndexes(rows.length);
  const points: TrendPoint[] = values.map((value, index) => ({
    value: value != null && Number.isFinite(value) ? value : null,
    itemStyle: { color: rows[index]?.judgement === "fail" ? "#df5363" : metric.color },
    symbolSize: rows[index]?.judgement === "fail" ? 9 : index === values.length - 1 ? 7 : 0
  }));
  const main: TrendSeries = {
    type: "line",
    data: points,
    connectNulls: false,
    smooth: false,
    showSymbol: true,
    symbol: "circle",
    lineStyle: { width: 2.5, color: metric.color },
    itemStyle: { color: metric.color, borderColor: "#fff", borderWidth: 1.5 },
    areaStyle: { color: metric.color, opacity: 0.075 },
    ...(mixed ? {} : {
      markLine: {
        silent: true as const,
        symbol: "none" as const,
        lineStyle: { color: "#e55c6c" as const, type: "dashed" as const },
        label: {
          position: "insideEndTop" as const,
          color: "#cb4555" as const,
          fontSize: 11 as const,
          formatter: `控制${metric.operator === ">=" ? "下" : "上"}限 ${threshold}${metric.unit}`,
          backgroundColor: "#fff5f6" as const,
          padding: 5 as const
        },
        data: [{ yAxis: threshold }]
      }
    })
  };
  const series: TrendSeries[] = [main];
  if (mixed) {
    series.push({
      name: "逐条记录阈值",
      type: "line",
      data: thresholds,
      step: "end",
      symbol: "none",
      lineStyle: { color: "#e55c6c", type: "dashed", width: 1.5 },
      tooltip: { show: true }
    });
  }
  return {
    animation: false,
    grid: { top: 26, right: 30, bottom: 30, left: 48 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#fff",
      borderColor: "#e7edf5",
      textStyle: { color: "#263650" },
      formatter(params: unknown) {
        const list = Array.isArray(params) ? params : [params];
        const first = list[0] as { dataIndex?: number } | undefined;
        const record = first && typeof first.dataIndex === "number" ? rows[first.dataIndex] : undefined;
        if (!record) return "";
        return `${escapeHtml(date(record.time))}<br>${escapeHtml(record.reelId)} · ${fmt(record.meter, 1)} m<br><strong>${escapeHtml(metric.short)}：${fmt(record.value)} ${escapeHtml(metric.unit)}</strong><br>点击查看完整记录`;
      }
    },
    xAxis: {
      type: "category",
      data: rows.map(record => (axis === "meter" ? fmt(record.meter, 1) : date(record.time).slice(-8, -3))),
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#e7edf5" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#8291a8",
        fontSize: 11,
        hideOverlap: true,
        showMaxLabel: true,
        interval: index => ticks.includes(index)
      }
    },
    yAxis: {
      type: "value",
      name: metric.unit,
      min: Math.min(limits[0], ...finite),
      // The 1.12 factor always uses the first sorted row, even when later rows have a higher threshold.
      max: Math.max(limits[1], ...finite, threshold * 1.12),
      interval: metric.id === "dg" ? 2 : metric.id === "jx" ? 1 : 2.5,
      splitNumber: 4,
      axisLabel: { color: "#8291a8", fontSize: 11 },
      splitLine: { lineStyle: { color: "#edf1f7" } },
      nameTextStyle: { color: "#8291a8", padding: [0, 0, 0, 10] }
    },
    series
  };
}
