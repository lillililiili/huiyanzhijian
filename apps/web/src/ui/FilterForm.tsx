import type { FormEvent, ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { EMPTY_FILTERS, resetFilters, setFilters, subscribeView, getViewSnapshot } from "../app/viewState";
import { Button } from "./Button";

export function useViewFilters(id: string): Record<string, string> {
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  return view.filters[id] ?? EMPTY_FILTERS;
}

export function FilterForm({ id, children }: { id: string; children: (filters: Record<string, string>) => ReactNode }) {
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters[id] ?? EMPTY_FILTERS;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values: Record<string, string> = {};
    for (const [key, value] of new FormData(event.currentTarget).entries()) {
      if (typeof value === "string") values[key] = value;
    }
    setFilters(id, values);
  }

  return (
    <form key={`${id}:${view.revision}`} className="filters" data-filter={id} onSubmit={onSubmit}>
      {children(filters)}
      <div className="filter-buttons">
        <Button primary type="submit" icon="search">查询</Button>
        <Button type="button" onClick={() => resetFilters(id)}>重置</Button>
      </div>
    </form>
  );
}
