/** CSV import parser. `_row` follows the prototype: header is row 1, and blank lines are dropped before numbering. */

export const IMPORT_BYTE_LIMIT = 5 * 1024 * 1024;
export const IMPORT_ROW_LIMIT = 10000;

const REQUIRED_HEADERS = ["taskId", "metric", "time", "meter", "value"];
const METRIC_IDS = ["dg", "jx", "by"];

export interface ParsedImportRow {
  _row: number;
  fields: Record<string, string>;
}

export interface ValidatedImportRow {
  taskId: string;
  metric: string;
  time: string;
  meter: number | null;
  value: number | null;
  validity: string;
  errors: string[];
  _row: number;
  fields: Record<string, string>;
}

export function assertImportSize(bytes: number) {
  if (bytes > IMPORT_BYTE_LIMIT) throw new Error("请将单个导入文件控制在 5MB 以内");
}

export function assertImportRowCount(count: number) {
  if (count > IMPORT_ROW_LIMIT) throw new Error("单次最多导入 10,000 条记录");
}

/** Same formula-injection rule as the record export. A leading = + @ or - is prefixed with a quote. */
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

export function buildImportTemplate(task: { id: string; metric: string }): string {
  return `\uFEFFtaskId,metric,time,meter,value,validity\r\n${task.id},${task.metric},2026-10-09 14:31:00,1240,12.36,valid\r\n`;
}

export function parseImportCsv(text: string): ParsedImportRow[] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") {
      if (quoted && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(item => item.trim())) table.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell);
  if (row.some(item => item.trim())) table.push(row);
  if (table.length < 2) throw new Error("CSV 至少需要表头和一条数据");
  const headers = (table.shift() ?? []).map(item => item.replace(/^\uFEFF/, "").trim());
  if (REQUIRED_HEADERS.some(header => !headers.includes(header))) {
    throw new Error("CSV 缺少必要表头：taskId, metric, time, meter, value");
  }
  return table.map((values, index) => {
    const fields: Record<string, string> = {};
    headers.forEach((header, column) => {
      fields[header] = (values[column] || "").trim();
    });
    return { _row: index + 2, fields };
  });
}

export function validateImportRows(
  rows: readonly ParsedImportRow[],
  taskMetric: (taskId: string) => string | undefined
): ValidatedImportRow[] {
  return rows.map(row => {
    const fields = row.fields;
    const errors: string[] = [];
    const metric = fields.metric || "";
    const time = fields.time || "";
    const knownMetric = taskMetric(fields.taskId || "");
    const value = fields.value === undefined || fields.value === "" ? null : Number(fields.value);
    const meter = fields.meter === undefined || fields.meter === "" ? null : Number(fields.meter);
    const validity = fields.validity || "valid";
    if (knownMetric === undefined) errors.push("任务不存在");
    else if (knownMetric !== metric) errors.push("检测项目与任务不一致");
    if (!METRIC_IDS.includes(metric)) errors.push("仅支持 dg / jx / by");
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) || !Number.isFinite(Date.parse(time.replace(" ", "T")))) {
      errors.push("时间格式应为 YYYY-MM-DD HH:mm:ss");
    }
    if (meter === null || !Number.isFinite(meter) || meter < 0) errors.push("米数必须是非负数字");
    if (validity !== "valid" && validity !== "invalid") errors.push("有效性仅支持 valid / invalid");
    if (validity === "valid" && (value === null || !Number.isFinite(value) || value < 0)) {
      errors.push("有效数据必须填写非负实测值");
    }
    return {
      taskId: fields.taskId || "",
      metric,
      time,
      meter,
      value,
      validity,
      errors,
      _row: row._row,
      fields
    };
  });
}

/** Drop preview-only fields. `source` is intentionally absent; the store writes 人工导入补录. */
export function toImportPayload(row: ValidatedImportRow): Record<string, unknown> {
  return {
    ...row.fields,
    taskId: row.taskId,
    metric: row.metric,
    time: row.time,
    meter: row.meter,
    value: row.value,
    validity: row.validity
  };
}
