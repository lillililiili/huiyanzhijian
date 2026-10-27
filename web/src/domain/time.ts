import type { DemoTime } from "./types";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function clean(value: unknown) {
  return String(value == null ? "" : value).trim();
}

export function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function pad(value: number | string) {
  return String(value).padStart(2, "0");
}

/** Treat the demo clock as UTC so a 30-minute window does not shift by the Shanghai offset. */
export function timeAdd(value: DemoTime, seconds: number): DemoTime {
  return new Date(Date.parse(value.replace(" ", "T") + "Z") + seconds * 1000).toISOString().slice(0, 19).replace("T", " ");
}
