import { useSyncExternalStore } from "react";

type ToastItem = { id: number; message: string };

let sequence = 0;
let items: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function resetToasts() {
  items = [];
  emit();
}

export function toast(message: string) {
  const id = sequence + 1;
  sequence = id;
  items = [...items, { id, message }];
  emit();
  window.setTimeout(() => {
    items = items.filter(item => item.id !== id);
    emit();
  }, 4200);
}

/** Matches the prototype click dispatcher: plain Error stays quiet in the console. */
export function notifyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  toast(message || "操作失败");
  if (!(error instanceof Error) || error.name !== "Error") console.error(error);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ToastViewport() {
  const current = useSyncExternalStore(subscribe, () => items, () => items);
  return (
    <div id="toast-root">
      {current.map(item => (
        <div key={item.id} className="toast" role="status">{item.message}</div>
      ))}
    </div>
  );
}
