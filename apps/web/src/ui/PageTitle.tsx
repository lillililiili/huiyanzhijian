import type { ReactNode } from "react";

export function PageTitle({ title, subtitle = "", actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
