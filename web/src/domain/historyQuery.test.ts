import assert from "node:assert/strict";
import test from "node:test";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { filterHistoryRecords, historyDefaults, resolveHistoryFilter } from "./historyQuery";
import { createStore } from "./store";

test("the first history window keeps 14:30:00 and is neither 87 nor the full table", () => {
  const source = createStore({ persistence: memoryPersistence() });
  const state = source.getState();
  const defaults = historyDefaults(state.settings.demoTime);
  assert.equal(defaults.start, "2026-10-09T14:01");
  assert.equal(defaults.end, "2026-10-09T14:30");
  assert.equal(filterHistoryRecords(state.records, defaults).length, 90);
  assert.equal(state.records.length, 198);
  assert.equal(filterHistoryRecords(state.records, { start: defaults.start, end: "2026-10-09T14:29" }).length, 87);
  assert.equal(filterHistoryRecords(state.records, {}).length, 198);
  const hit = filterHistoryRecords(state.records, { ...defaults, metric: "dg", judgement: "fail", query: "P20261009001" });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].value, 9.2);
  assert.equal(hit[0].ruleSnapshot.version, "V1.0");
  assert.equal(hit[0].ruleSnapshot.id, "DG-V1.0");
});

test("a URL metric applies only before the history form writes a metric", () => {
  const open = resolveHistoryFilter(undefined, "dg", "2026-10-09 14:30:00");
  assert.equal(open.metric, "dg");
  assert.equal(open.start, "2026-10-09T14:01");
  assert.equal(open.end, "2026-10-09T14:30");
  const partial = resolveHistoryFilter({ start: "2026-10-09T14:01", end: "2026-10-09T14:30" }, "jx", "2026-10-09 14:30:00");
  assert.equal(partial.metric, "jx");
  const submitted = resolveHistoryFilter({ metric: "", start: "", end: "" }, "dg", "2026-10-09 14:30:00");
  assert.equal(submitted.metric, "");
  assert.equal(submitted.start, "");
  assert.equal(submitted.end, "");
});
