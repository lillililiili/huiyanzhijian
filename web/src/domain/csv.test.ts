import assert from "node:assert/strict";
import test from "node:test";
import {
  assertImportRowCount,
  assertImportSize,
  buildImportTemplate,
  escapeCsvCell,
  IMPORT_BYTE_LIMIT,
  IMPORT_ROW_LIMIT,
  parseImportCsv,
  toImportPayload,
  validateImportRows
} from "./csv";

test("parseImportCsv keeps quotes, escaped quotes, CRLF, BOM and skips blank lines", () => {
  const csv = "\uFEFFtaskId,metric,time,meter,value,note\r\n\r\n\"T1\",\"dg\",\"2026-10-09 14:31:00\",\"1\",\"12\",\"say \"\"hi\"\"\"\r\n";
  const rows = parseImportCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._row, 2);
  assert.equal(rows[0].fields.taskId, "T1");
  assert.equal(rows[0].fields.note, "say \"hi\"");
  assert.equal(rows[0].fields.value, "12");
});

test("parseImportCsv rejects a short file, a missing header and an open quote", () => {
  assert.throws(() => parseImportCsv("taskId,metric,time,meter,value\n"), /至少需要表头和一条数据/);
  assert.throws(() => parseImportCsv("taskId,metric\nT1,dg\n"), /缺少必要表头：taskId, metric, time, meter, value/);
  assert.throws(() => parseImportCsv("taskId,metric,time,meter,value\n\"open,dg,2026-10-09 14:31:00,1,12\n"), /引号未闭合/);
});

test("import limits are 5 MB and 10,000 data rows", () => {
  assert.doesNotThrow(() => assertImportSize(IMPORT_BYTE_LIMIT));
  assert.throws(() => assertImportSize(IMPORT_BYTE_LIMIT + 1), /5MB/);
  assert.doesNotThrow(() => assertImportRowCount(IMPORT_ROW_LIMIT));
  assert.throws(() => assertImportRowCount(IMPORT_ROW_LIMIT + 1), /10,000/);
});

test("validateImportRows reports task, metric, time, meter, validity and value errors", () => {
  const rows = validateImportRows([
    { _row: 2, fields: { taskId: "MISSING", metric: "nope", time: "yesterday", meter: "-1", value: "", validity: "maybe" } },
    { _row: 3, fields: { taskId: "T1", metric: "jx", time: "2026-10-09 14:31:00", meter: "10", value: "1.2", validity: "valid" } },
    { _row: 4, fields: { taskId: "T1", metric: "dg", time: "2026-10-09 14:32:00", meter: "11", value: "", validity: "invalid" } },
    { _row: 5, fields: { taskId: "T1", metric: "dg", time: "2026-10-09 14:33:00", meter: "12", value: "", validity: "valid" } }
  ], id => (id === "T1" ? "dg" : undefined));
  assert.deepEqual(rows[0].errors, [
    "任务不存在",
    "仅支持 dg / jx / by",
    "时间格式应为 YYYY-MM-DD HH:mm:ss",
    "米数必须是非负数字",
    "有效性仅支持 valid / invalid"
  ]);
  assert.deepEqual(rows[1].errors, ["检测项目与任务不一致"]);
  assert.deepEqual(rows[2].errors, []);
  assert.deepEqual(rows[3].errors, ["有效数据必须填写非负实测值"]);
  assert.equal(rows[2].value, null);
  assert.equal(rows[2].validity, "invalid");
  const payload = toImportPayload(rows[2]);
  assert.equal(Object.hasOwn(payload, "_row"), false);
  assert.equal(Object.hasOwn(payload, "errors"), false);
  assert.equal(Object.hasOwn(payload, "source"), false);
  assert.equal(payload.value, null);
});

test("template and formula escaping stay local and quoted", () => {
  assert.equal(escapeCsvCell("=1+1"), "\"'=1+1\"");
  assert.equal(escapeCsvCell("safe \"quote\""), "\"safe \"\"quote\"\"\"");
  const template = buildImportTemplate({ id: "T20261009001", metric: "dg" });
  assert.equal(template.startsWith("\uFEFF"), true);
  assert.equal(template.includes("taskId,metric,time,meter,value,validity\r\nT20261009001,dg,2026-10-09 14:31:00,1240,12.36,valid\r\n"), true);
});
