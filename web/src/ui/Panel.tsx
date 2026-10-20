import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  tools,
  className = "",
  core = false,
  table = false
}: {
  title: string;
  children: ReactNode;
  tools?: ReactNode;
  className?: string;
  core?: boolean;
  table?: boolean;
}) {
  const classes = ["panel", core ? "core-panel" : "", className].filter(Boolean).join(" ");
  const bodyClass = table ? "panel-body core-panel-body core-panel-table" : "panel-body core-panel-body";
  return (
    <section className={classes}>
      <div className="panel-head">
        <h2>{title}</h2>
        <div className="panel-tools">{tools}</div>
      </div>
      {core ? <div className={bodyClass}>{children}</div> : children}
    </section>
  );
}
