import { afterEach, expect, test } from "vitest";
import { filtersFor, pageFor, paginate, resetFilters, resetViewState, setFilters, setPage } from "./viewState";

afterEach(() => {
  resetViewState();
});

test("submitting filters returns to page 1 and reset clears that key only", () => {
  setPage("history", 4);
  setPage("tasks", 3);
  setFilters("history", { reel: "P20261009001", metric: "dg" });
  expect(filtersFor("history")).toEqual({ reel: "P20261009001", metric: "dg" });
  expect(pageFor("history")).toBe(1);
  expect(pageFor("tasks")).toBe(3);
  resetFilters("history");
  expect(filtersFor("history")).toEqual({});
  expect(pageFor("history")).toBe(1);
  expect(pageFor("tasks")).toBe(3);
});

test("page size prefers the settings value and clamps the page", () => {
  const items = Array.from({ length: 10 }, (_, index) => index + 1);
  expect(paginate(items, 1, 8).items).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(paginate(items, 2, 8)).toMatchObject({ items: [9, 10], page: 2, pages: 2, pageSize: 8, total: 10 });
  expect(paginate(items, 9, 8, 10)).toMatchObject({ items, page: 1, pages: 1, pageSize: 10 });
  expect(paginate([], 4, 8)).toMatchObject({ items: [], page: 1, pages: 1, pageSize: 8 });
  expect(paginate(items, 2, 8, 0).pageSize).toBe(8);
});
