import type { AnchorHTMLAttributes, ReactNode } from "react";

type HashLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  route: string;
  children: ReactNode;
};

export function HashLink({ route, children, ...rest }: HashLinkProps) {
  return (
    <a {...rest} href={`#${route}`}>
      {children}
    </a>
  );
}
