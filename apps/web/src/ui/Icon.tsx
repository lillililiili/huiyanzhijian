import type { CSSProperties } from "react";
import { iconFileName } from "./iconMap";

function iconAssetUrl(file: string) {
  let base = "./";
  try {
    const configured = import.meta.env.BASE_URL;
    if (typeof configured === "string" && configured.length > 0) base = configured;
  } catch {
    base = "./";
  }
  if (!base.endsWith("/")) base += "/";
  // CSS mask URLs must resolve against the document, not the built CSS directory.
  const relative = `${base}assets/icons/${file}.svg`;
  return typeof document === "undefined" ? relative : new URL(relative, document.baseURI).href;
}

export function Icon({ name = "activity", size = 20 }: { name?: string; size?: number }) {
  const pixels = Number(size) || 20;
  const url = iconAssetUrl(iconFileName(name));
  const style = {
    width: pixels,
    height: pixels,
    ["--icon" as string]: `url("${url}")`
  } as CSSProperties;
  return <span className="icon" aria-hidden="true" style={style} />;
}
