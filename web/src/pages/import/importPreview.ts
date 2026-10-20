import type { ValidatedImportRow } from "../../domain/csv";

export interface ImportPreview {
  name: string;
  rows: ValidatedImportRow[];
}

let preview: ImportPreview | null = null;
const listeners = new Set<() => void>();

export function subscribeImportPreview(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getImportPreview(): ImportPreview | null {
  return preview;
}

export function setImportPreview(next: ImportPreview | null) {
  preview = next;
  for (const listener of [...listeners]) listener();
}

export function resetImportPreview() {
  setImportPreview(null);
}
