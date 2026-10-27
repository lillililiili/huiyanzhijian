export interface ViewSnapshot {
  filters: Record<string, Record<string, string>>;
  pages: Record<string, number>;
  revision: number;
}

export const EMPTY_FILTERS: Record<string, string> = {};

let snapshot: ViewSnapshot = { filters: {}, pages: {}, revision: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeView(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getViewSnapshot(): ViewSnapshot {
  return snapshot;
}

export function filtersFor(key: string): Record<string, string> {
  return snapshot.filters[key] ?? EMPTY_FILTERS;
}

export function pageFor(key: string): number {
  return snapshot.pages[key] ?? 1;
}

export function setFilters(key: string, values: Record<string, string>) {
  snapshot = {
    filters: { ...snapshot.filters, [key]: { ...values } },
    pages: { ...snapshot.pages, [key]: 1 },
    revision: snapshot.revision
  };
  emit();
}

export function resetFilters(key: string) {
  const filters = { ...snapshot.filters };
  const pages = { ...snapshot.pages };
  delete filters[key];
  delete pages[key];
  snapshot = { filters, pages, revision: snapshot.revision + 1 };
  emit();
}

export function setPage(key: string, page: number) {
  const next = Math.max(1, Math.floor(page) || 1);
  if (snapshot.pages[key] === next) return;
  snapshot = { ...snapshot, pages: { ...snapshot.pages, [key]: next } };
  emit();
}

export function resetViewState() {
  snapshot = { filters: {}, pages: {}, revision: 0 };
  emit();
}

export function paginate<T>(items: readonly T[], page: number, fallbackSize = 8, configured?: number | null) {
  const pageSize = Number(configured) || fallbackSize;
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(pages, Math.max(1, Number(page) || 1));
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pages,
    pageSize,
    total: items.length
  };
}
