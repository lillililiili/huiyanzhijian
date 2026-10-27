import type { ReactNode } from "react";

export type BadgeTone = "green" | "blue" | "red" | "amber" | "gray";

export function Badge({ children, tone = "green" }: { children: ReactNode; tone?: BadgeTone | string }) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
