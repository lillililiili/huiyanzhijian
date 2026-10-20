import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import { getViewSnapshot, pageFor, paginate, setPage, subscribeView } from "../app/viewState";
import { Button } from "./Button";

export function usePagination<T>(items: readonly T[], pageKey: string, fallbackSize = 8, configured?: number | null) {
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const stored = view.pages[pageKey] ?? 1;
  const window = paginate(items, stored, fallbackSize, configured);
  useEffect(() => {
    if (stored !== window.page) setPage(pageKey, window.page);
  }, [pageKey, stored, window.page]);
  return window;
}

export function Pagination({
  pageKey,
  total,
  page,
  pages,
  pageSize
}: {
  pageKey: string;
  total: number;
  page: number;
  pages: number;
  pageSize: number;
}) {
  return (
    <div className="pagination">
      <span>共 {total} 条记录</span>
      <div className="page-controls">
        <Button type="button" onClick={() => setPage(pageKey, Math.max(1, page - 1))}>上一页</Button>
        <span className="page-number">{page}</span>
        <span>/ {pages}</span>
        <Button type="button" onClick={() => setPage(pageKey, Math.min(pages, page + 1))}>下一页</Button>
        <span>{pageSize} 条 / 页</span>
      </div>
    </div>
  );
}

export { pageFor, paginate };
