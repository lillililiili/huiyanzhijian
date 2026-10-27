import { expect, test } from "vitest";
import { METRICS } from "../domain/metrics";
import type { InspectionRecord } from "../domain/types";
import { trendOption, type TrendPoint } from "./trendOption";

function row(patch: Partial<InspectionRecord> & Pick<InspectionRecord, "id" | "time" | "value">): InspectionRecord {
  return {
    taskId: "T20261009001",
    metric: "dg",
    deviceId: "HY-DG-01",
    reelId: "P20261009001",
    workOrder: "WO20261009001",
    meter: 100,
    validity: "valid",
    judgement: "pass",
    ruleSnapshot: { id: "DG-V1.0", version: "V1.0", threshold: 10, operator: ">=" },
    image: "assets/images/copper-inspection.png",
    source: "设备自动采集",
    platformStatus: "received",
    mesStatus: "confirmed",
    receivedAt: patch.time,
    confirmedAt: patch.time,
    aux: {},
    ...patch
  };
}

test("a single threshold draws the control line and drops invalid points", () => {
  const option = trendOption(METRICS.dg, [
    row({ id: "late", time: "2026-10-09 14:30:00", value: 12.36, meter: 2261 }),
    row({ id: "bad", time: "2026-10-09 14:02:00", value: 9.2, validity: "invalid", judgement: "invalid" }),
    row({ id: "early", time: "2026-10-09 14:01:00", value: 11, judgement: "fail" })
  ]);
  const series = option.series[0];
  const points = series.data as TrendPoint[];
  expect(option.animation).toBe(false);
  expect(option.grid).toEqual({ top: 26, right: 30, bottom: 30, left: 48 });
  expect(option.tooltip.backgroundColor).toBe("#fff");
  expect(option.tooltip.borderColor).toBe("#e7edf5");
  expect(option.tooltip.textStyle).toEqual({ color: "#263650" });
  expect(option.xAxis.axisLine).toEqual({ lineStyle: { color: "#e7edf5" } });
  expect(option.yAxis.splitLine).toEqual({ lineStyle: { color: "#edf1f7" } });
  expect(option.yAxis.nameTextStyle).toEqual({ color: "#8291a8", padding: [0, 0, 0, 10] });
  expect(option.xAxis.data).toEqual(["14:01", "14:02", "14:30"]);
  expect(points.map(point => point.value)).toEqual([11, null, 12.36]);
  expect(series.connectNulls).toBe(false);
  expect(series.smooth).toBe(false);
  expect(series.lineStyle).toEqual({ width: 2.5, color: "#155ab6" });
  expect(series.areaStyle).toEqual({ color: "#155ab6", opacity: 0.075 });
  expect(points[0].itemStyle.color).toBe("#df5363");
  expect(points[0].symbolSize).toBe(9);
  expect(points[2].symbolSize).toBe(7);
  expect(points[1].symbolSize).toBe(0);
  expect(series.markLine?.lineStyle.color).toBe("#e55c6c");
  expect(series.markLine?.label.color).toBe("#cb4555");
  expect(series.markLine?.label.formatter).toBe("控制下限 10%");
  expect(series.markLine?.data).toEqual([{ yAxis: 10 }]);
  expect(option.yAxis.min).toBe(8);
  expect(option.yAxis.max).toBe(16);
  expect(option.xAxis.axisLabel.showMaxLabel).toBe(true);
  expect(option.xAxis.axisLabel.hideOverlap).toBe(true);
  expect([0, 1, 2].filter(index => option.xAxis.axisLabel.interval(index))).toEqual([0, 1, 2]);
  expect(option.tooltip.formatter([{ dataIndex: 2 }])).toContain("点击查看完整记录");
  expect(option.tooltip.formatter([{ dataIndex: 2 }])).toContain("P20261009001");
  expect(JSON.stringify(option.series)).not.toContain("#d34858");
  expect(option.series).toHaveLength(1);
});

test("mixed thresholds use the first row for the axis and a step line instead of markLine", () => {
  const option = trendOption(METRICS.jx, [
    row({ id: "b", time: "2026-10-09 14:02:00", metric: "jx", value: 1.5, meter: 20, ruleSnapshot: { id: "JX-V1.1", version: "V1.1", threshold: 10, operator: "<=" } }),
    row({ id: "a", time: "2026-10-09 14:01:00", metric: "jx", value: 1.2, meter: 10, ruleSnapshot: { id: "JX-V1.0", version: "V1.0", threshold: 3, operator: "<=" } })
  ], "meter");
  expect(option.series[0].markLine).toBeUndefined();
  expect(option.series[1].name).toBe("逐条记录阈值");
  expect(option.series[1].step).toBe("end");
  expect(option.series[1].symbol).toBe("none");
  expect(option.series[1].lineStyle).toEqual({ color: "#e55c6c", type: "dashed", width: 1.5 });
  expect(option.series[1].data).toEqual([3, 10]);
  expect(option.yAxis.max).toBe(Math.max(4, 1.2, 1.5, 3 * 1.12));
  expect(option.yAxis.interval).toBe(1);
  expect(option.series[0].lineStyle?.color).toBe("#1289ad");
  expect(option.xAxis.data).toEqual(["10.0", "20.0"]);
});

test("an empty series stays finite and roundness keeps its own color", () => {
  const option = trendOption(METRICS.by, []);
  expect(option.yAxis.min).toBe(0);
  expect(option.yAxis.max).toBe(10);
  expect(Number.isFinite(option.yAxis.min)).toBe(true);
  expect(Number.isFinite(option.yAxis.max)).toBe(true);
  expect(option.series[0].lineStyle?.color).toBe("#079981");
  expect(option.series[0].markLine?.label.formatter).toBe("控制上限 8%");
});
