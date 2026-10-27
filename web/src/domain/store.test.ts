import assert from "node:assert/strict";
import test from "node:test";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { createStore, type InspectionStore } from "./store";

function app(options: { items?: Map<string, string>; blocked?: boolean } = {}) {
  const items = options.items ?? new Map<string, string>();
  const store = createStore({ persistence: memoryPersistence(items, options.blocked === true) });
  return { S: store, items };
}

function input(store: InspectionStore, extra: Record<string, unknown> = {}) {
  const recipe = store.getState().recipes.find(item => item.metric === "dg" && item.enabled);
  assert.ok(recipe);
  return { workOrder: "WO-TEST-001", reelId: "P-TEST-001", specId: "SP035-400", metric: "dg", deviceId: "HY-DG-01", recipeId: recipe.id, plannedLength: 30, ...extra };
}

test("seed data is coherent across 12 tasks, 90 current records and independent statuses", () => {
  const { S } = app();
  assert.equal(JSON.stringify(S.getState()).length, 210834);
  assert.equal(S.getState().tasks.length, 12);
  assert.equal(S.getState().tasks.filter(task => task.status === "running").length, 3);
  assert.equal(S.getState().tasks.filter(task => task.status === "completed").length, 9);
  assert.equal(S.getState().devices.filter(device => device.status === "online").length, 3);
  assert.equal(S.getState().specs.length, 6);
  const summary = S.stats(S.currentRecords());
  assert.equal(summary.total, 90);
  assert.equal(summary.valid, 90);
  assert.equal(summary.pass, 88);
  assert.equal(summary.fail, 2);
  assert.equal(S.currentRecords("dg").at(-1)?.value, 12.36);
  assert.equal(S.currentRecords("jx").at(-1)?.value, 1.52);
  assert.equal(S.currentRecords("by").at(-1)?.value, 4.37);
  assert.equal(S.stats(S.currentRecords("jx")).avg, 1.8);
  assert.equal(S.stats(S.currentRecords("by")).avg, 4.25);
  const pending = S.getState().alarms.filter(alarm => alarm.status === "pending");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].active, false);
  assert.equal(S.record(pending[0].recordId)?.value, 9.2);
  for (const record of S.getState().records) {
    const task = S.task(record.taskId);
    assert.ok(task);
    assert.equal(record.metric, task.metric);
    assert.equal(record.reelId, task.reelId);
    assert.equal(record.deviceId, task.deviceId);
    assert.equal(record.judgement, S.judge(record.value, record.metric, record.ruleSnapshot, record.validity));
  }
});

test("all threshold boundaries are inclusive and missing data is never coerced to zero", () => {
  const { S } = app();
  for (const [metric, boundary, outside] of [["dg", 10, 9.99], ["jx", 3, 3.01], ["by", 8, 8.01]] as const) {
    assert.equal(S.judge(boundary, metric), "pass");
    assert.equal(S.judge(outside, metric), "fail");
  }
  for (const missing of [null, undefined, "", "  ", Number.NaN, Number.POSITIVE_INFINITY, false]) assert.equal(S.judge(missing, "jx"), "invalid");
  assert.equal(S.judge(0, "jx"), "pass");
  assert.equal(S.judge(12, "dg", undefined, "invalid"), "invalid");
  assert.throws(() => S.judge(3, "diameter"), /三项/);
});

test("stats exclude invalid values while exposing the latest invalid record for current-state UI", () => {
  const { S } = app();
  const rows = [{ value: 2, validity: "valid", judgement: "pass", time: "2026-10-09 14:01:00" }, { value: null, validity: "invalid", judgement: "invalid", time: "2026-10-09 14:02:00" }];
  const summary = S.stats(rows);
  assert.equal(summary.valid, 1);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.avg, 2);
  assert.equal(summary.min, 2);
  assert.equal(summary.last?.value, null);
  assert.equal(S.stats([]).avg, null);
  assert.equal(S.stats([]).last, null);
});

test("task validation rejects wrong metric, equipment, voltage and missing required fields", () => {
  const { S } = app();
  assert.throws(() => S.createTask(input(S, { workOrder: "" })), /不能为空/);
  assert.throws(() => S.createTask(input(S, { metric: "jx" })), /不适用/);
  assert.throws(() => S.createTask(input(S, { deviceId: "HY-JX-01" })), /不匹配/);
  assert.throws(() => S.createTask(input(S, { plannedLength: 0 })), /计划长度/);
  const spec = S.spec("SP035-400");
  assert.ok(spec);
  spec.voltage = 10;
  assert.throws(() => S.createTask(input(S)), /35–220/);
});

test("create, assign, start, measure and finish preserves single-metric applicability", () => {
  const { S } = app();
  const task = S.createTask(input(S));
  assert.equal(task.status, "pending");
  assert.equal(S.recordsFor(task.id).length, 0);
  assert.throws(() => S.createTask(input(S)), /已有未完成/);
  assert.throws(() => S.startTask(task.id), /已有检测中/);
  S.completeTask("T20261009001");
  S.startTask(task.id);
  assert.throws(() => S.completeTask(task.id), /尚无检测记录/);
  for (let index = 0; index < 3; index += 1) S.advanceTask(task.id);
  S.completeTask(task.id);
  assert.equal(task.status, "completed");
  assert.equal(task.measuredLength, 30);
  assert.equal(S.recordsFor(task.id).length, 3);
  assert.ok(S.recordsFor(task.id).every(record => record.metric === "dg"));
  const report = S.createReport(task.id);
  assert.equal(report.kind, "final");
  assert.equal(report.snapshot.stats.valid, 3);
});

test("offline equipment blocks acquisition without introducing fake zero measurements", () => {
  const { S } = app();
  S.setScenario("offline");
  const before = S.getState().records.length;
  assert.throws(() => S.advanceTask("T20261009001"), /离线/);
  assert.equal(S.getState().records.length, before);
  assert.equal(S.device("HY-DG-01")?.status, "offline");
  S.setScenario("normal");
  assert.equal(S.device("HY-DG-01")?.status, "online");
});

test("restored readings do not automatically close pending alarms; resolution requires notes", () => {
  const { S } = app();
  const alarm = S.alarm("AL20261009001");
  assert.ok(alarm);
  const original = JSON.stringify(S.record(alarm.recordId));
  assert.equal(alarm.active, false);
  assert.equal(alarm.status, "pending");
  assert.throws(() => S.updateAlarm(alarm.id, { status: "resolved", note: "" }), /说明/);
  S.updateAlarm(alarm.id, { status: "processing", note: "开始复核原始量测" });
  S.updateAlarm(alarm.id, { status: "resolved", note: "复核设备原图与连续后续记录，完成处置" });
  assert.equal(alarm.status, "resolved");
  assert.equal(JSON.stringify(S.record(alarm.recordId)), original);
  assert.equal(alarm.history.length, 4);
});

test("recipe revision cannot rewrite historical rule snapshots or invert the judgement direction", () => {
  const { S } = app();
  const old = S.recipe("DG-V1.0");
  const task = S.task("T20261009001");
  assert.ok(old);
  assert.ok(task);
  const original = JSON.stringify(task.ruleSnapshot);
  const record = S.recordsFor(task.id)[0];
  const next = S.reviseRecipe(old.id, { name: "高要求配方", threshold: 13, operator: ">=" });
  assert.equal(next.version, "V1.1");
  assert.equal(next.threshold, 13);
  assert.equal(old.enabled, false);
  assert.equal(S.recipe(old.id), old);
  assert.equal(JSON.stringify(task.ruleSnapshot), original);
  assert.equal(record.ruleSnapshot.threshold, 10);
  assert.equal(record.judgement, "pass");
  assert.throws(() => S.reviseRecipe(next.id, { threshold: 12, operator: "<=" }), /下限/);
  const created = S.createTask(input(S, { recipeId: next.id }));
  assert.equal(created.ruleSnapshot.threshold, 13);
});

test("reports remain deep snapshots, running tasks create stages and unresolved alarms block final reports", () => {
  const { S } = app();
  const report = S.createReport("T20261009001");
  assert.equal(report.kind, "stage");
  assert.equal(report.snapshot.task.status, "running");
  const original = JSON.stringify(report.snapshot);
  S.getState().reportTemplate.title = "新的报告标题";
  const spec = S.spec("SP035-400");
  const device = S.device("HY-DG-01");
  assert.ok(spec);
  assert.ok(device);
  spec.area = 500;
  device.name = "新设备显示名称";
  S.advanceTask("T20261009001");
  S.completeTask("T20261009001");
  assert.equal(JSON.stringify(report.snapshot), original);
  assert.throws(() => S.createReport("T20261009001"), /复核/);
  S.updateAlarm("AL20261009001", { status: "resolved", note: "已复核并处理" });
  const finalReport = S.createReport("T20261009001");
  assert.equal(finalReport.kind, "final");
  assert.equal(finalReport.snapshot.stats.fail, 1);
  assert.notEqual(finalReport.snapshot.task, S.task(finalReport.taskId));
  assert.notEqual(finalReport.snapshot.records[0], S.recordsFor(finalReport.taskId)[0]);
});

test("MES retry is idempotent, failed sync is independent from measurement validity", () => {
  const { S } = app();
  S.setScenario("mes-failure");
  const failed = S.getState().records.filter(record => record.mesStatus === "failed");
  assert.equal(failed.length, 3);
  assert.ok(failed.every(record => record.validity === "valid"));
  assert.equal(S.retrySync().count, 0);
  S.setScenario("normal");
  const before = S.getState().records.length;
  assert.equal(S.retrySync().count, 3);
  assert.equal(S.retrySync().count, 0);
  assert.equal(S.getState().records.length, before);
  assert.ok(failed.every(record => record.mesStatus === "confirmed"));
  assert.throws(() => S.retrySync(["unknown"]), /不存在/);
});

test("CSV imports accept valid rows, report row-level errors, preserve blanks as invalid and prevent duplicates", () => {
  const { S } = app();
  const base = { taskId: "T20261009001", metric: "dg", time: "2026-10-09 14:31:00", meter: 1240, value: 12 };
  const out = S.importRecords([base, { ...base, time: "2026-10-09 14:32:00", value: "" }, { ...base, time: "2026-10-09 14:33:00", metric: "x" }, { ...base, time: "2026-10-09 14:34:00", value: null, validity: "invalid" }]);
  assert.equal(out.count, 2);
  assert.equal(out.errors.length, 2);
  assert.equal(out.errors[0].row, 2);
  assert.equal(out.errors[0].line, 3);
  const invalid = S.recordsFor(base.taskId).at(-1);
  assert.equal(invalid?.value, null);
  assert.equal(invalid?.judgement, "invalid");
  assert.equal(S.importRecords([base]).count, 0);
  assert.equal(S.importRecords([{ ...base, time: "2026-02-30 14:01:00" }]).count, 0);
  assert.equal(S.importRecords([{ ...base, time: "2026-10-09 14:40:00", deviceId: "HY-JX-01" }]).count, 0);
});

test("backfilled historical failures create pending recovered alarms without changing previously generated reports", () => {
  const { S } = app();
  const historical = S.task("T20261009004");
  assert.ok(historical);
  const report = S.getState().reports.find(item => item.taskId === historical.id);
  assert.ok(report);
  const original = JSON.stringify(report.snapshot);
  const result = S.importRecords([{ taskId: historical.id, metric: "dg", time: "2026-10-09 08:05:30", meter: 75, value: 9 }]);
  assert.equal(result.count, 1);
  const alarm = S.getState().alarms.at(-1);
  assert.equal(alarm?.active, false);
  assert.equal(alarm?.status, "pending");
  assert.equal(JSON.stringify(report.snapshot), original);
  assert.equal(S.recordsFor(historical.id).length, 13);
});

test("auxiliary data keeps local gaps distinct and does not invent an out-of-roundness formula", () => {
  const { S } = app();
  const wire = S.currentRecords("jx").at(-1);
  const roundness = S.currentRecords("by").at(-1);
  assert.ok(wire?.aux.localGaps);
  assert.equal(wire.aux.localGaps.length, 4);
  assert.equal(Math.round(wire.aux.localGaps.reduce((sum, gap) => sum + gap, 0) / 4 * 100) / 100, wire.value);
  assert.equal(roundness?.aux.xDiameter, 66.42);
  assert.equal(roundness?.aux.yDiameter, 63.52);
  assert.equal(roundness?.value, 4.37);
  assert.equal(Object.hasOwn(roundness?.aux ?? {}, "formula"), false);
});

test("invalid scenario retains null records, excludes them from pass rate, and normal scenario preserves history", () => {
  const { S } = app();
  S.setScenario("invalid");
  const invalid = S.getState().records.filter(record => record.validity === "invalid");
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].value, null);
  const summary = S.stats(S.currentRecords());
  assert.equal(summary.invalid, 1);
  assert.equal(summary.valid, 87);
  S.setScenario("normal");
  assert.equal(S.record(invalid[0].id)?.value, null);
});

test("saved state survives reload; corrupt or incompatible storage safely falls back; reset restores exact seeds", () => {
  const { S, items } = app();
  const task = S.createTask(input(S));
  const reloaded = app({ items }).S;
  assert.equal(reloaded.task(task.id)?.workOrder, "WO-TEST-001");
  reloaded.reset();
  assert.equal(reloaded.getState().tasks.length, 12);
  assert.equal(reloaded.currentRecords().length, 90);
  items.set(S.key, "{broken");
  const corrupt = app({ items });
  assert.equal(corrupt.S.getState().tasks.length, 12);
  assert.equal(corrupt.S.memoryOnly, true);
  assert.equal(items.get(S.key), "{broken");
  items.set(S.key, JSON.stringify({ schemaVersion: 999 }));
  const incompatible = app({ items });
  assert.equal(incompatible.S.getState().tasks.length, 12);
  assert.equal(incompatible.S.memoryOnly, false);
  assert.equal(items.get(S.key), JSON.stringify({ schemaVersion: 999 }));
  const blocked = app({ blocked: true }).S;
  assert.equal(blocked.createTask(input(blocked)).status, "pending");
  assert.equal(blocked.memoryOnly, true);
});

test("audit actor uses the active mock session user", () => {
  const { S } = app();
  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  const entry = S.log("查看报告", "RP-TEST");
  assert.equal(entry.actor, "质量审核员");
  assert.equal(entry.role, "quality");
});

test("disabled MES leaves a new automatic record pending instead of confirmed", () => {
  const { S } = app();
  S.getState().mes.enabled = false;
  const record = S.advanceTask("T20261009001");
  assert.equal(record.mesStatus, "pending");
  assert.equal(record.confirmedAt, null);
  assert.equal(record.platformStatus, "received");
  assert.equal(record.source, "设备自动采集");
  assert.notEqual(S.getState().settings.scenario, "mes-failure");
});

test("saveSpec enforces shield applicability and does not rewrite task snapshots", () => {
  const { S } = app();
  const before = JSON.stringify(S.task("T20261009001")?.ruleSnapshot);
  const report = S.createReport("T20261009001");
  const snapshotArea = report.snapshot.spec?.area;
  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  const draft = { id: "SP035-240", voltage: 35, area: 240, cores: 1, structure: "tape", metrics: ["dg", "by"], enabled: true };
  assert.throws(() => S.saveSpec({ ...draft, voltage: 10 }), /35、66、110、220/);
  assert.throws(() => S.saveSpec({ ...draft, metrics: ["dg", "jx"] }), /铜带屏蔽规格不适用铜丝间隙检测/);
  assert.throws(() => S.saveSpec({ ...draft, id: "SP066-240", voltage: 66, structure: "wire", metrics: ["dg", "by"] }), /铜丝屏蔽规格不适用金属屏蔽搭盖率检测/);
  assert.throws(() => S.saveSpec({ ...draft, metrics: [] }), /至少选择一个适用检测项目/);
  assert.throws(() => S.saveSpec({ ...draft, id: "SP035-400" }), /规格编号已存在/);
  const created = S.saveSpec({ ...draft, metrics: ["by"] });
  assert.equal(created.structure, "tape");
  assert.deepEqual(created.metrics, ["by"]);
  assert.equal(S.getState().specs.length, 7);
  const edited = S.saveSpec({ ...draft, id: "SP035-400", area: 500, update: true });
  assert.equal(edited.area, 500);
  assert.equal(edited.customerCode, "HV-035-400");
  assert.equal(S.getState().specs.length, 7);
  assert.equal(JSON.stringify(S.task("T20261009001")?.ruleSnapshot), before);
  assert.equal(report.snapshot.spec?.area, snapshotArea);
  assert.equal(S.getState().audits.at(-1)?.action, "修改产品规格");
  S.setSession({ id: "U004", name: "只读访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveSpec(draft), /当前为只读角色，请切换质量管理员或检测操作员后操作/);
  assert.equal(S.getState().specs.length, 7);
});

test("saveMetricDisplay changes only decimals and description inside 0–4", () => {
  const { S } = app();
  const record = S.currentRecords("dg").at(-1);
  assert.ok(record);
  const before = JSON.stringify(record);
  assert.throws(() => S.saveMetricDisplay("zz", { decimals: 2 }), /检测项目/);
  assert.throws(() => S.saveMetricDisplay("dg", { decimals: 5 }), /0–4/);
  assert.throws(() => S.saveMetricDisplay("dg", { decimals: -1 }), /0–4/);
  assert.throws(() => S.saveMetricDisplay("dg", { decimals: 1.5 }), /0–4/);
  assert.throws(() => S.saveMetricDisplay("dg", { decimals: "" }), /0–4/);
  assert.equal(S.getState().settings.metricDisplay, undefined);
  const saved = S.saveMetricDisplay("dg", { decimals: 0, description: "  仅供展示  " });
  assert.equal(saved.decimals, 0);
  assert.equal(saved.description, "仅供展示");
  const firstMap = S.getState().settings.metricDisplay as Record<string, { decimals: number; description: string }>;
  assert.equal(firstMap.dg.decimals, 0);
  assert.equal(JSON.stringify(S.record(record.id)), before);
  assert.equal(record.value, 12.36);
  assert.equal(S.metrics.dg.threshold, 10);
  S.setSession({ id: "U004", name: "只读访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveMetricDisplay("jx", { decimals: 3, description: "访客" }), /当前角色为只读，不能修改演示数据。/);
  assert.equal((S.getState().settings.metricDisplay as { jx?: unknown }).jx, undefined);
  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  S.saveMetricDisplay("jx", { decimals: 3, description: "" });
  const latest = S.getState().settings.metricDisplay as { dg: { decimals: number; description: string }; jx: { decimals: number; description: string } };
  assert.equal(latest.dg.decimals, 0);
  assert.equal(latest.dg.description, "仅供展示");
  assert.equal(latest.jx.decimals, 3);
  assert.equal(latest.jx.description, "");
  assert.equal(firstMap.jx, undefined);
  assert.equal(S.getState().audits.at(-1)?.action, "更新指标显示配置");
  assert.equal(S.getState().audits.at(-1)?.detail, "铜丝屏蔽相邻铜丝间隙");
  assert.equal(S.stats(S.currentRecords("jx")).avg, 1.8);
});

test("gap recipe thresholds stay inside 0–100", () => {
  const { S } = app();
  assert.throws(() => S.reviseRecipe("JX-V1.0", { threshold: 150, operator: "<=" }), /请输入 0–100 范围内的有效阈值/);
  assert.throws(() => S.reviseRecipe("JX-V1.0", { threshold: -0.01, operator: "<=" }), /请输入 0–100 范围内的有效阈值/);
  const next = S.reviseRecipe("JX-V1.0", { threshold: 100, operator: "<=" });
  assert.equal(next.threshold, 100);
  assert.equal(next.version, "V1.1");
  assert.equal(S.recipe("JX-V1.0")?.enabled, false);
});

test("saveTemplate advances revision without rewriting existing report snapshots", () => {
  const S = createStore({ persistence: memoryPersistence(), now: () => "2026-10-16T08:00:00.000Z" });
  const prior = S.getState().reports[0];
  assert.ok(prior);
  const original = JSON.stringify(prior.snapshot);
  const template = S.getState().reportTemplate;
  assert.throws(() => S.saveTemplate({ title: "   " }), /报告抬头/);
  assert.equal(S.getState().reportTemplate, template);
  assert.equal(template.version, "V1.0");
  const first = S.saveTemplate({
    title: " 新抬头 ",
    signatory: " 审核 ",
    footer: " 页脚 ",
    includeLogo: true,
    includeTrend: false,
    includeAlarms: true,
    includeDetails: false
  });
  assert.equal(first.revision, 2);
  assert.equal(first.version, "V1.1");
  assert.equal(first.title, "新抬头");
  assert.equal(first.header, "新抬头");
  assert.equal(first.signatory, "审核");
  assert.equal(first.footer, "页脚");
  assert.equal(first.includeLogo, true);
  assert.equal(first.includeTrend, false);
  assert.equal(first.includeAlarms, true);
  assert.equal(first.includeDetails, false);
  assert.equal(first.updatedAt, "2026-10-16T08:00:00.000Z");
  assert.equal(first.name, "高压电缆检测报告");
  assert.equal(first.company, "山东沉积岩信息科技有限公司");
  assert.equal(first.showCharts, true);
  assert.equal(first.showRecords, true);
  assert.equal(JSON.stringify(prior.snapshot), original);
  assert.equal(prior.snapshot.template.title, "高压电缆质量检测报告");
  assert.equal(template.title, "高压电缆质量检测报告");
  assert.equal(S.getState().audits.at(-1)?.action, "修改报告模板");
  assert.equal(S.getState().audits.at(-1)?.detail, "版本 V1.1");
  const created = S.createReport("T20261009003");
  assert.equal(created.kind, "stage");
  assert.equal(created.snapshot.template.title, "新抬头");
  assert.equal(created.snapshot.template.header, "新抬头");
  assert.equal(created.snapshot.template.includeTrend, false);
  assert.equal(JSON.stringify(prior.snapshot), original);
  const second = S.saveTemplate({ title: "第二版" });
  assert.equal(second.revision, 3);
  assert.equal(second.version, "V1.2");
  assert.equal(second.includeLogo, false);
  assert.equal(second.includeTrend, false);
  assert.equal(second.includeAlarms, false);
  assert.equal(second.includeDetails, false);
  assert.equal(second.signatory, "");
  assert.equal(second.footer, "");
  assert.equal(second.name, "高压电缆检测报告");
  assert.equal(created.snapshot.template.version, "V1.1");
  S.setSession({ id: "U004", name: "只读访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveTemplate({ title: "访客" }), /当前角色为只读，不能修改演示数据。/);
  assert.equal(S.getState().reportTemplate.version, "V1.2");
  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  const third = S.saveTemplate({
    title: "质量修订",
    includeLogo: true,
    includeTrend: true,
    includeAlarms: true,
    includeDetails: true,
    signatory: "质量审核员",
    footer: "页脚"
  });
  assert.equal(third.revision, 4);
  assert.equal(third.version, "V1.3");
  const later = S.createReport("T20261009002");
  assert.equal(later.snapshot.template.version, "V1.3");
  assert.equal(later.snapshot.template.title, "质量修订");
  assert.equal(created.snapshot.template.version, "V1.1");
  assert.equal(JSON.stringify(prior.snapshot), original);
});

test("a successful command replaces the state root and the changed array", () => {
  const { S } = app();
  const first = S.getState();
  const records = first.records;
  S.advanceTask("T20261009001");
  const second = S.getState();
  assert.notEqual(second, first);
  assert.notEqual(second.records, records);
  assert.equal(S.getState(), second);
});

test("device, connection and MES writes are admin-only and keep unrelated snapshots", () => {
  const { S } = app();
  const deviceCount = S.getState().devices.length;
  const recordCount = S.getState().records.length;
  assert.throws(() => S.saveDevice({ id: "bad id", name: "设备", metric: "dg", line: "工位", status: "online" }), /设备编号仅支持字母、数字、下划线和短横线/);
  assert.throws(() => S.saveDevice({ id: "HY-DG-01", name: "改名", metric: "jx", line: "铜带屏蔽工位", status: "online", update: true }), /已有测量记录的设备不能修改检测类型/);
  assert.throws(() => S.saveDevice({ id: "HY-DG-01", name: "改名", metric: "dg", line: "铜带屏蔽工位", status: "online" }), /设备编号已存在。/);
  assert.throws(() => S.saveDevice({ id: "MISSING", name: "设备", metric: "dg", line: "工位", status: "online", update: true }), /设备不存在/);
  const edited = S.saveDevice({ id: "HY-DG-01", name: "金属屏蔽搭盖率检测设备", metric: "dg", line: "铜带屏蔽工位", calibration: "2026-12-31", status: "offline", update: true });
  assert.equal(edited.status, "offline");
  assert.equal(edited.metric, "dg");
  assert.equal(edited.ip, "192.168.10.101");
  assert.equal(edited.model, "HY-DG");
  assert.equal(edited.image, "assets/images/device-dg.png");
  assert.equal(edited.source, "设备自动采集");
  assert.equal(S.getState().records.filter(record => record.deviceId === "HY-DG-01").length > 0, true);
  assert.equal(S.getState().records.every(record => record.deviceId !== "HY-DG-01" || record.metric === "dg"), true);
  const created = S.saveDevice({ id: "HY-DG-02", name: "新增搭盖设备", metric: "dg", line: "独立工位", status: "online", calibration: "" });
  assert.equal(created.image, "assets/images/device-dg.png");
  assert.equal(created.model, "");
  assert.equal(created.ip, "");
  assert.equal(created.source, "设备自动采集");
  assert.equal(created.lastSeen, "2026-10-09 14:30:00");
  assert.equal(S.getState().devices.length, deviceCount + 1);
  assert.equal(S.getState().audits.at(-1)?.action, "新增设备");
  assert.equal(S.getState().audits.at(-1)?.detail, "HY-DG-02");

  const previousConnections = S.getState().connections;
  assert.throws(() => S.saveConnections({ protocol: "FTP", endpoint: "ftp://local", interval: 1000, heartbeat: 30, autoReconnect: true }), /请选择有效的接入协议/);
  assert.throws(() => S.saveConnections({ protocol: "HTTP", endpoint: "  ", interval: 1000, heartbeat: 30, autoReconnect: true }), /请填写演示接入地址/);
  assert.throws(() => S.saveConnections({ protocol: "HTTP", endpoint: "http://127.0.0.1/m", interval: 99, heartbeat: 30, autoReconnect: true }), /采样间隔须在 100–60000 ms/);
  const savedConnections = S.saveConnections({ protocol: "MQTT", endpoint: "mqtt://demo.local/measurements", interval: 500, heartbeat: 15, autoReconnect: false });
  assert.notEqual(savedConnections, previousConnections);
  assert.equal(previousConnections.endpoint, undefined);
  assert.equal(previousConnections.protocol, "HTTP");
  assert.equal(savedConnections.protocol, "MQTT");
  assert.equal(savedConnections.endpoint, "mqtt://demo.local/measurements");
  assert.equal(savedConnections.interval, 500);
  assert.equal(savedConnections.pollInterval, 500);
  assert.equal(savedConnections.heartbeat, 15);
  assert.equal(savedConnections.autoReconnect, false);
  assert.equal(savedConnections.mapping.taskId, "task_id");
  assert.equal(savedConnections.mapping.meter, "meter");
  assert.equal(savedConnections.dg.host, "192.168.10.101");
  assert.equal(savedConnections.jx.host, "192.168.10.102");
  assert.equal(savedConnections.by.host, "192.168.10.103");
  assert.equal(savedConnections.host, "127.0.0.1");
  assert.equal(savedConnections.mode, "simulation");
  assert.equal(S.getState().audits.at(-1)?.action, "修改数据接入配置");
  assert.equal(S.getState().audits.at(-1)?.detail, "本地模拟 · MQTT");

  const previousMes = S.getState().mes;
  assert.throws(() => S.saveMes({ endpoint: "ftp://example.com/quality", mode: "record", timeout: 10000, retries: 3, enabled: true }), /演示地址须为 http 或 https 地址。/);
  assert.throws(() => S.saveMes({ endpoint: "https://mes.example.local/api/quality", mode: "simulation", timeout: 10000, retries: 3, enabled: true }), /请选择推送方式/);
  const savedMes = S.saveMes({ endpoint: " https://mes.example.local/api/quality ", mode: "record", timeout: 10000, retries: 0, enabled: false, token: "secret" });
  assert.notEqual(savedMes, previousMes);
  assert.equal(previousMes.mode, "simulation");
  assert.equal(previousMes.token, "");
  assert.equal(previousMes.endpoint, "https://mes.example.local/api/inspection");
  assert.equal(savedMes.endpoint, "https://mes.example.local/api/quality");
  assert.equal(savedMes.url, savedMes.endpoint);
  assert.equal(savedMes.mode, "record");
  assert.equal(savedMes.timeout, 10000);
  assert.equal(savedMes.retries, 0);
  assert.equal(savedMes.enabled, false);
  assert.equal(savedMes.token, "");
  assert.equal(savedMes.method, "POST");
  assert.equal(savedMes.authType, "Bearer Token");
  assert.equal(savedMes.mapping.taskId, "task_code");
  assert.equal(S.getState().audits.at(-1)?.action, "修改 MES 接口配置");
  assert.equal(S.getState().audits.at(-1)?.detail, "本地模拟配置");
  assert.equal(S.getState().records.length, recordCount);

  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  assert.throws(() => S.saveDevice({ id: "HY-DG-03", name: "设备", metric: "dg", line: "工位", status: "online" }), /此操作需要系统管理员角色，请切换演示身份。/);
  assert.throws(() => S.saveConnections({ protocol: "HTTP", endpoint: "http://127.0.0.1:8080/measurements", interval: 1000, heartbeat: 30, autoReconnect: true }), /此操作需要系统管理员角色，请切换演示身份。/);
  assert.throws(() => S.saveMes({ endpoint: "https://mes.example.local/api/inspection", mode: "batch", timeout: 10000, retries: 3, enabled: true }), /此操作需要系统管理员角色，请切换演示身份。/);
  S.setSession({ id: "U004", name: "只读访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveDevice({ id: "HY-DG-03", name: "设备", metric: "dg", line: "工位", status: "online" }), /此操作需要系统管理员角色，请切换演示身份。/);
  assert.throws(() => S.retrySync(["R-T20261009001-30"]), /当前角色为只读，不能修改演示数据。/);
  assert.equal(S.getState().devices.length, deviceCount + 1);
  assert.equal(S.getState().mes.enabled, false);
  S.setSession({ id: "U001", name: "质量管理员", username: "admin", role: "admin" });
  const restored = S.saveMes({ endpoint: "https://mes.example.local/api/inspection", mode: "batch", timeout: 5000, retries: 3, enabled: true });
  assert.equal(restored.enabled, true);
  assert.equal(restored.mode, "batch");
  assert.equal(restored.token, "");
});

test("saveUser keeps the last admin, blocks self-disable, and writes the new session into the audit", () => {
  const { S } = app();
  const open = S.saveUser({ name: "无会话", account: "nosession", role: "viewer", enabled: true });
  assert.equal(open.username, "nosession");
  assert.equal(open.account, "nosession");
  assert.equal(open.department, "");
  assert.equal(open.lastLogin, null);
  assert.equal(open.id.startsWith("U"), true);
  assert.equal(S.getState().users.length, 5);
  assert.equal(S.getState().audits.at(-1)?.action, "新增演示用户");
  assert.equal(S.getState().audits.at(-1)?.detail, "nosession · 只读观察员");

  const beforeDeny = S.getState().users.length;
  const auditsBeforeDeny = S.getState().audits.length;
  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  assert.throws(() => S.saveUser({ name: "越权", account: "quality01", role: "quality", enabled: true }), /此操作需要系统管理员角色，请切换演示身份。/);
  S.setSession({ id: "U004", name: "访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveUser({ name: "越权", account: "viewer01", role: "viewer", enabled: true }), /此操作需要系统管理员角色，请切换演示身份。/);
  assert.equal(S.getState().users.length, beforeDeny);
  assert.equal(S.getState().audits.length, auditsBeforeDeny);

  S.setSession({ id: "U001", name: "质量管理员", username: "admin", role: "admin" });
  assert.throws(() => S.saveUser({}), /请填写用户姓名/);
  assert.throws(() => S.saveUser({ name: "短账号", account: "ab", role: "quality", enabled: true }), /登录账号须为 3–40 位字母、数字、点、下划线或短横线/);
  assert.throws(() => S.saveUser({ update: true, id: "U999", name: "缺失", account: "missing01", role: "viewer", enabled: true }), /用户不存在/);
  assert.throws(() => S.saveUser({ name: "重复", account: "admin", role: "quality", enabled: true }), /该账号已经存在。/);

  const guest = S.saveUser({ update: true, id: "U004", name: "访客", account: "guest01", role: "viewer", enabled: false });
  assert.equal(guest.username, "guest01");
  assert.equal(guest.account, "guest01");
  assert.equal(guest.department, "演示用户");
  assert.equal(guest.lastLogin, null);
  assert.equal(guest.enabled, false);
  assert.equal(S.getState().audits.at(-1)?.action, "修改用户与角色");
  assert.equal(S.getState().audits.at(-1)?.detail, "guest01 · 只读观察员");

  assert.throws(() => S.saveUser({ update: true, id: "U001", name: "质量管理员", account: "admin", role: "quality", enabled: true }), /至少保留一位启用的系统管理员。/);
  assert.throws(() => S.saveUser({ update: true, id: "U001", name: "质量管理员", account: "admin", role: "admin", enabled: false }), /至少保留一位启用的系统管理员。/);
  assert.equal(S.getState().users.find(item => item.id === "U001")?.role, "admin");
  assert.equal(S.getState().users.find(item => item.id === "U001")?.enabled, true);

  const second = S.saveUser({ name: "备份管理员", account: "backup01", role: "admin", enabled: "true" });
  assert.equal(second.department, "");
  assert.equal(second.lastLogin, null);
  assert.equal(second.username, "backup01");
  assert.equal(S.getState().audits.at(-1)?.action, "新增演示用户");
  assert.equal(S.getState().audits.at(-1)?.detail, "backup01 · 系统管理员");
  assert.throws(() => S.saveUser({ update: true, id: "U001", name: "质量管理员", account: "admin", role: "admin", enabled: "false" }), /当前会话用户不能停用自己。/);
  assert.equal(S.getState().users.find(item => item.id === "U001")?.enabled, true);

  const renamed = S.saveUser({ update: true, id: "U001", name: "现场管理员", account: "admin01", role: "admin", enabled: true });
  assert.equal(renamed.name, "现场管理员");
  assert.equal(renamed.username, "admin01");
  assert.equal(S.getState().audits.at(-1)?.actor, "现场管理员");
  assert.equal(S.getState().audits.at(-1)?.role, "admin");
  assert.equal(S.getState().audits.at(-1)?.action, "修改用户与角色");
  S.log("会话探针", "用户名不进入审计角色");
  assert.equal(S.getState().audits.at(-1)?.actor, "现场管理员");
  assert.equal(S.getState().audits.at(-1)?.role, "admin");
});

test("saveSettings publishes a new object and leaves the previous settings intact", () => {
  const { S } = app();
  const previous = S.getState().settings;
  previous.metricDisplay = { decimals: 2 };
  const saved = S.saveSettings({ platformName: " 验收平台 ", organization: " 沉积岩实验室 ", refreshInterval: "10", pageSize: "20" });
  assert.notEqual(saved, previous);
  assert.equal(previous.platformName, "线缆质量管控平台");
  assert.equal(previous.company, "山东沉积岩信息科技有限公司");
  assert.equal(previous.organization, undefined);
  assert.equal(saved.platformName, "验收平台");
  assert.equal(saved.organization, "沉积岩实验室");
  assert.equal(saved.company, "沉积岩实验室");
  assert.equal(saved.refreshInterval, 10);
  assert.equal(saved.pageSize, 20);
  assert.equal(saved.demoTime, "2026-10-09 14:30:00");
  assert.equal(saved.scenario, "normal");
  assert.deepEqual(saved.metricDisplay, { decimals: 2 });
  assert.equal(S.getState().settings, saved);
  assert.equal(S.getState().audits.at(-1)?.action, "修改系统设置");
  assert.equal(S.getState().audits.at(-1)?.detail, "平台名称、机构与演示偏好");

  assert.throws(() => S.saveSettings({ platformName: "  ", organization: "机构", refreshInterval: 5, pageSize: 8 }), /请填写平台名称/);
  assert.throws(() => S.saveSettings({ platformName: "平台", organization: " ", refreshInterval: 5, pageSize: 8 }), /请填写所属机构/);
  assert.throws(() => S.saveSettings({ platformName: "平台", organization: "机构", refreshInterval: 7, pageSize: 8 }), /请选择回放刷新间隔/);
  assert.throws(() => S.saveSettings({ platformName: "平台", organization: "机构", refreshInterval: 5, pageSize: 15 }), /请选择默认分页大小/);
  assert.equal(S.getState().settings.platformName, "验收平台");

  S.setSession({ id: "U003", name: "质量审核员", username: "quality", role: "quality" });
  assert.throws(() => S.saveSettings({ platformName: "越权", organization: "机构", refreshInterval: 5, pageSize: 8 }), /此操作需要系统管理员角色，请切换演示身份。/);
  S.setSession({ id: "U004", name: "访客", username: "viewer", role: "viewer" });
  assert.throws(() => S.saveSettings({ platformName: "越权", organization: "机构", refreshInterval: 5, pageSize: 8 }), /此操作需要系统管理员角色，请切换演示身份。/);
  assert.equal(S.getState().settings, saved);
  assert.equal(S.getState().settings.pageSize, 20);
});
