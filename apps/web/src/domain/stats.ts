import type { Stats } from "./types";
import { round } from "./time";

interface StatsRow {
  value?: unknown;
  validity?: string;
  judgement?: string;
  time?: string;
}

export function stats(records: readonly StatsRow[]): Stats {
  const rows = Array.isArray(records) ? records : [];
  const valid = rows.filter(row => row.validity === "valid" && row.value !== null && row.value !== "" && Number.isFinite(Number(row.value)) && row.judgement !== "invalid");
  const values = valid.map(row => Number(row.value));
  return {
    total: rows.length,
    valid: valid.length,
    invalid: rows.length - valid.length,
    pass: valid.filter(row => row.judgement === "pass").length,
    fail: valid.filter(row => row.judgement === "fail").length,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    avg: values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null,
    last: rows.length ? rows.slice().sort((a, b) => String(a.time).localeCompare(String(b.time))).at(-1) ?? null : null
  };
}
