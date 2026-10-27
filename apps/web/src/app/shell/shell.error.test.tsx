import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { setSessionUser } from "../../auth/session";
import { createStore } from "../../domain/store";
import { memoryPersistence } from "../../persistence/memoryPersistence";
import { resetReturnRoute } from "../hashRoute";

vi.mock("../../pages/users/UsersPage", () => ({
  UsersPage() {
    throw new Error("占位失败");
  }
}));

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalError = console.error;

function installMatchMedia() {
  const query = {
    matches: false,
    media: "(max-width: 1023px)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; }
  };
  window.matchMedia = () => query as unknown as MediaQueryList;
}

afterEach(() => {
  console.error = originalError;
  if (root) act(() => { root?.unmount(); });
  container?.remove();
  root = null;
  container = null;
  setSessionUser(null);
  resetReturnRoute();
  window.location.hash = "";
});

test("a thrown page shows the reload boundary instead of a blank screen", async () => {
  console.error = (...args: unknown[]) => {
    const text = args.map(item => String(item)).join(" ");
    if (text.includes("占位失败") || text.includes("The above error") || text.includes("React will try")) return;
    originalError(...args);
  };
  const { App } = await import("../App");
  installMatchMedia();
  setSessionUser({ id: "U001", name: "质量管理员", username: "admin", role: "admin" });
  resetReturnRoute();
  window.location.hash = "#users";
  const store = createStore({ persistence: memoryPersistence() });
  container = document.createElement("div");
  document.body.appendChild(container);
  const localRoot = createRoot(container);
  root = localRoot;
  act(() => {
    localRoot.render(<App store={store} />);
  });
  expect(document.querySelector("#main-content h1")?.textContent).toBe("页面加载失败");
  expect(document.querySelector("#main-content p")?.textContent).toBe("占位失败");
  expect([...document.querySelectorAll("#main-content button")].some(button => button.textContent === "重新加载")).toBe(true);
});
