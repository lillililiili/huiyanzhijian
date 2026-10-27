import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";

const compactValueStyle: CSSProperties = {
  fontSize: 22,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  lineHeight: 1.5
};

export function Kpi({
  label,
  value,
  note = "",
  icon = "activity",
  tone = "blue",
  compact = false
}: {
  label: string;
  value: ReactNode;
  note?: string;
  icon?: string;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <article className="kpi">
      <span className={`kpi-icon ${tone}`}>
        <Icon name={icon} size={27} />
      </span>
      <div>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value" style={compact ? compactValueStyle : undefined}>{value}</div>
        <div className="kpi-note">{note}</div>
      </div>
    </article>
  );
}
