import type { ReactNode } from "react";
import type { InspectionRecord, Spec } from "../domain/types";

export function timeOnly(value: unknown) {
  const text = String(value || "");
  return text.length >= 19 ? text.slice(11, 19) : "—";
}

export function specLabel(spec: Spec | undefined) {
  if (!spec) return "—";
  return `${spec.voltage}kV · ${spec.cores || 1}×${spec.area}mm²`;
}

export function latestRecord(rows: readonly InspectionRecord[]) {
  return rows.slice().sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id))[0];
}

export function MetricHero({ value, unit, tone = "" }: { value: ReactNode; unit: string; tone?: string }) {
  return (
    <div className={`metric-hero${tone ? ` ${tone}` : ""}`}>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

export function ValueWithUnit({ value, unit, spaced = false }: { value: ReactNode; unit: string; spaced?: boolean }) {
  return (
    <>
      {value}
      <small>{spaced ? ` ${unit}` : unit}</small>
    </>
  );
}

export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="meta-item">
      <span className="muted small">{label}</span>
      <div>{children}</div>
    </div>
  );
}
