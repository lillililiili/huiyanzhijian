const focusableSelector = "a[href],button,input,select,textarea,[tabindex]";

function isDisabled(node: HTMLElement) {
  return "disabled" in node && Boolean((node as HTMLInputElement).disabled);
}

export function visibleFocusables(container: HTMLElement | null) {
  if (!container) return [];
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(node => {
    return !isDisabled(node) && node.getAttribute("tabindex") !== "-1" && node.offsetParent !== null && !node.closest("[inert]");
  });
}

export function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  const nodes = visibleFocusables(container);
  if (!nodes.length) {
    container?.focus();
    event.preventDefault();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!container?.contains(active)) {
    (event.shiftKey ? last : first).focus();
    event.preventDefault();
  } else if (event.shiftKey && active === first) {
    last.focus();
    event.preventDefault();
  } else if (!event.shiftKey && active === last) {
    first.focus();
    event.preventDefault();
  }
}
