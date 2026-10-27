import { useEffect, useRef, type RefObject } from "react";
import { trapFocus } from "./focusTrap";

function initialTarget(node: HTMLElement, initial: "form" | "button") {
  if (initial === "form") {
    return node.querySelector("form")?.querySelector<HTMLElement>("input,select,textarea,button") ?? null;
  }
  return node.querySelector<HTMLElement>("button");
}

export function useDialog(open: boolean, onClose: () => void, nodeRef: RefObject<HTMLElement | null>, initial: "form" | "button") {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = nodeRef.current;
    const timer = initial === "form"
      ? window.setTimeout(() => {
          if (node) initialTarget(node, "form")?.focus();
        }, 20)
      : 0;
    if (node && initial === "button") initialTarget(node, "button")?.focus();

    function onKey(event: KeyboardEvent) {
      const current = nodeRef.current;
      if (!current) return;
      const modalOpen = document.querySelector(".modal");
      if (modalOpen && !current.classList.contains("modal")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") trapFocus(event, current);
    }

    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, initial, nodeRef]);
}
