import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { METRICS } from "../domain/metrics";
import type { InspectionRecord } from "../domain/types";
import { TrendChart } from "./TrendChart";

const charts = vi.hoisted(() => [] as Array<{
  option: unknown;
  disposed: boolean;
  handler?: (params: unknown) => void;
}>);

vi.mock("echarts", () => ({
  init() {
    const chart = {
      option: null as unknown,
      disposed: false,
      handler: undefined as ((params: unknown) => void) | undefined,
      setOption(option: unknown) { chart.option = option; },
      on(_event: string, handler: (params: unknown) => void) { chart.handler = handler; },
      resize() {},
      dispose() { chart.disposed = true; }
    };
    charts.push(chart);
    return chart;
  }
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  charts.splice(0);
});

test("the chart host disposes on unmount and opens only the main series", () => {
  const record = {
    id: "R-1",
    taskId: "T1",
    metric: "dg",
    deviceId: "HY-DG-01",
    reelId: "P1",
    workOrder: "WO",
    time: "2026-10-09 14:30:00",
    meter: 10,
    value: 12.36,
    validity: "valid",
    judgement: "pass",
    ruleSnapshot: { id: "DG-V1.0", version: "V1.0", threshold: 10, operator: ">=" },
    image: "assets/images/copper-inspection.png",
    source: "设备自动采集",
    platformStatus: "received",
    mesStatus: "confirmed",
    receivedAt: "2026-10-09 14:30:00",
    confirmedAt: "2026-10-09 14:30:00",
    aux: {}
  } as InspectionRecord;
  const opened: string[] = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<TrendChart metric={METRICS.dg} records={[record]} onPoint={item => opened.push(item.id)} />);
  });
  expect(container?.querySelector(".chart-host")?.getAttribute("aria-label")).toContain("金属屏蔽搭盖率");
  expect(charts).toHaveLength(1);
  act(() => { charts[0].handler?.({ seriesIndex: 1, dataIndex: 0 }); });
  expect(opened).toEqual([]);
  act(() => { charts[0].handler?.({ seriesIndex: 0, dataIndex: 0 }); });
  expect(opened).toEqual(["R-1"]);
  act(() => { root?.unmount(); });
  root = null;
  expect(charts[0].disposed).toBe(true);
});
