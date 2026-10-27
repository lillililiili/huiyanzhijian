import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";
import { afterEach, expect, test } from "vitest";
import { filtersFor, pageFor, resetViewState, setPage } from "../app/viewState";
import type { InspectionRecord } from "../domain/types";
import { DataTable } from "./DataTable";
import { Empty } from "./Empty";
import { FilterForm } from "./FilterForm";
import { Kpi } from "./Kpi";
import { PageTitle } from "./PageTitle";
import { Pagination } from "./Pagination";
import { Panel } from "./Panel";
import { RecordTable } from "./RecordTable";
import { StatusBadge, statusPair } from "./StatusBadge";
import { buildRecordsCsv, csvCell } from "./download";
import { date, fmt, metricFmt, ruleLabel, thresholdText } from "./format";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root?.render(node); });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  resetViewState();
});

test("numbers, dates and thresholds format independently", () => {
  expect(fmt(null)).toBe("—");
  expect(fmt(Number.NaN)).toBe("—");
  expect(fmt(Number.POSITIVE_INFINITY)).toBe("—");
  expect(fmt(2261, 1)).toBe("2,261.0");
  expect(fmt(12.36, 0)).toBe("12");
  expect(date("2026-10-09T14:30:00.000Z")).toBe("2026-10-09 14:30:00");
  expect(date("")).toBe("—");
  expect(thresholdText(10.25)).toBe("10.25");
  expect(metricFmt(10.25, "dg", { dg: { decimals: 0 } })).toBe("10");
  expect(thresholdText(10.25)).not.toBe(metricFmt(10.25, "dg", { dg: { decimals: 0 } }));
  expect(ruleLabel({ operator: ">=", unit: "%", threshold: 10.25 })).toBe("≥ 10.25 %");
});

test("pending text stays on four separate tables", () => {
  expect(statusPair("pending", "generic")).toEqual(["待处理", "amber"]);
  expect(statusPair("pending", "task")).toEqual(["待开始", "gray"]);
  expect(statusPair("pending", "alarm")).toEqual(["待复核", "red"]);
  expect(statusPair("pending", "mes")).toEqual(["待同步", "blue"]);
  expect(statusPair("invalid", "generic")).toEqual(["无有效数据", "gray"]);
  expect(statusPair("invalid", "alarm")[0]).toBe("invalid");
  render(<StatusBadge value="pending" kind="mes" />);
  expect(container?.querySelector(".badge.blue")?.textContent).toBe("待同步");
});

test("shared layout pieces use the prototype class names", () => {
  render(
    <>
      <PageTitle title="工作台首页" subtitle="今日检测" />
      <Panel title="趋势" core>图</Panel>
      <Kpi label="今日检测任务" value={12} note="含检测中" icon="clipboard" />
      <Empty />
    </>
  );
  expect(container?.querySelector("h1")?.textContent).toBe("工作台首页");
  expect(container?.querySelector(".panel.core-panel h2")?.textContent).toBe("趋势");
  expect(container?.querySelector(".kpi-value")?.textContent).toBe("12");
  expect(container?.querySelector(".empty strong")?.textContent).toBe("暂无数据");
});

test("an empty table uses the caller copy and never prints NaN", () => {
  render(<DataTable headers={["记录编号", "实测值"]} rows={[]} />);
  expect(container?.querySelector(".empty strong")?.textContent).toBe("未找到符合条件的记录");
  expect(container?.textContent).not.toContain("NaN");
  act(() => {
    root?.render(<DataTable headers={["记录编号", "实测值"]} rows={[["R1", Number.NaN]]} emptyText="没有记录" />);
  });
  expect(container?.textContent).toContain("R1");
  expect(container?.textContent).toContain("—");
  expect(container?.textContent).not.toContain("NaN");
});

test("record rows keep generic MES wording and open the requested id", () => {
  const seen: string[] = [];
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
    mesStatus: "pending",
    receivedAt: "2026-10-09 14:30:00",
    confirmedAt: null,
    aux: {}
  } as InspectionRecord;
  render(<RecordTable records={[record]} onView={id => seen.push(id)} />);
  expect(container?.textContent).toContain("14:30:00");
  expect(container?.textContent).toContain(">= 10%");
  expect(container?.querySelector(".badge.amber")?.textContent).toBe("待处理");
  expect(container?.textContent).not.toContain("待同步");
  act(() => { container?.querySelector("button")?.click(); });
  expect(seen).toEqual(["R-1"]);
});

test("filter submit stores the form and reset clears the inputs", () => {
  setPage("history", 4);
  render(
    <FilterForm id="history">
      {filters => <input name="reel" aria-label="盘号" defaultValue={filters.reel ?? ""} />}
    </FilterForm>
  );
  const input = container?.querySelector("input") as HTMLInputElement;
  act(() => {
    input.value = "P20261009001";
    (container?.querySelector("button.primary") as HTMLButtonElement).click();
  });
  expect(filtersFor("history").reel).toBe("P20261009001");
  expect(pageFor("history")).toBe(1);
  act(() => {
    [...(container?.querySelectorAll("button") ?? [])].find(button => button.textContent === "重置")?.click();
  });
  expect(filtersFor("history")).toEqual({});
  expect((container?.querySelector("input") as HTMLInputElement).value).toBe("");
});

test("pagination shows the record count and moves to the next page", () => {
  render(<Pagination pageKey="history" total={90} page={1} pages={12} pageSize={8} />);
  expect(container?.textContent).toContain("共 90 条记录");
  expect(container?.textContent).toContain("8 条 / 页");
  act(() => {
    [...(container?.querySelectorAll("button") ?? [])].find(button => button.textContent === "下一页")?.click();
  });
  expect(pageFor("history")).toBe(2);
});

test("csv export adds a bom, crlf and a formula prefix", () => {
  expect(csvCell("=1+1")).toBe(`"'=1+1"`);
  expect(csvCell("safe \"quote\"")).toBe(`"safe ""quote"""`);
  const csv = buildRecordsCsv([{
    id: "R-1",
    taskId: "T1",
    metric: "dg",
    deviceId: "HY-DG-01",
    reelId: "P1",
    workOrder: "=WO",
    time: "2026-10-09T14:30:00.000Z",
    meter: 10,
    value: 9.2,
    validity: "valid",
    judgement: "fail",
    ruleSnapshot: { id: "DG-V1.0", version: "V1.0", threshold: 10, operator: ">=" },
    image: "",
    source: "设备自动采集",
    platformStatus: "received",
    mesStatus: "pending",
    receivedAt: "",
    confirmedAt: null,
    aux: {}
  }]);
  expect(csv.startsWith("\uFEFF\"记录编号\"")).toBe(true);
  expect(csv).toContain("\r\n");
  expect(csv).toContain(`"'=WO"`);
  expect(csv).toContain("2026-10-09 14:30:00");
  expect(csv).toContain(">=10");
});
