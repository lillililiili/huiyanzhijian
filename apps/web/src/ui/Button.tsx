import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean;
  icon?: string;
  children: ReactNode;
};

export function Button({ primary = false, icon, className, type = "button", children, ...rest }: ButtonProps) {
  const classes = ["btn", primary ? "primary" : "", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <Icon name={icon} size={17} /> : null}
      {children}
    </button>
  );
}
