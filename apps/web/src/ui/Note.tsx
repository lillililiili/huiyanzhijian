import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Note({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "amber" | "green" | "red" | "gray" }) {
  return (
    <div className={`note ${tone}`}>
      <Icon name="shield" size={17} />
      <span>{children}</span>
    </div>
  );
}
