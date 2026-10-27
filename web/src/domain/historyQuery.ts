import type { InspectionRecord } from "./types";
import { timeAdd } from "./time";

export interface HistoryFilter {
  query?: string;
  metric?: string;
  judgement?: string;
  start?: string;
  end?: string;
}

/** Minute-precision datetime-local values. End comparison adds :59 so 14:30:00 stays inside the window. */
export function historyDefaults(demoTime: string | undefined): { start: string; end: string } {
  const end = demoTime || "2026-10-09 14:30:00";
  const start = timeAdd(end, -29 * 60);
  return {
    start: start.replace(" ", "T").slice(0, 16),
    end: end.replace(" ", "T").slice(0, 16)
  };
}

/**
 * `written` absent means the page has not submitted yet: use the default window, and `?metric=` still applies.
 * After submit, an empty metric is "" and does not fall back to the URL.
 */
export function resolveHistoryFilter(
  written: Record<string, string> | undefined,
  metricParam: string | null,
  demoTime: string | undefined
): HistoryFilter {
  const defaults = historyDefaults(demoTime);
  if (!written) {
    return { query: "", metric: metricParam || "", judgement: "", start: defaults.start, end: defaults.end };
  }
  return {
    query: written.query || "",
    metric: Object.prototype.hasOwnProperty.call(written, "metric") ? written.metric : (metricParam || ""),
    judgement: written.judgement || "",
    start: written.start || "",
    end: written.end || ""
  };
}

export function filterHistoryRecords(records: readonly InspectionRecord[], filter: HistoryFilter): InspectionRecord[] {
  const query = (filter.query || "").toLowerCase();
  const wanted = filter.metric || "";
  const judgement = filter.judgement || "";
  const start = filter.start ? filter.start.replace("T", " ") : "";
  const end = filter.end ? `${filter.end.replace("T", " ")}:59` : "";
  return records.filter(record => (
    (!query || `${record.reelId} ${record.workOrder} ${record.id}`.toLowerCase().includes(query))
    && (!wanted || record.metric === wanted)
    && (!judgement || record.judgement === judgement)
    && (!start || record.time >= start)
    && (!end || record.time <= end)
  )).slice().sort((left, right) => right.time.localeCompare(left.time) || right.id.localeCompare(left.id));
}
