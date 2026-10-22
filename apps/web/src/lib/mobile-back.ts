import { useEffect, useRef } from 'react';
interface BackHandler {
  callback: () => boolean;
  priority: number;
}
const handlers = new Map<symbol, BackHandler>();
const visible = (element: Element) => !element.closest('[hidden], [inert], dialog:not([open])');
/** Explicit UI-only contract: no filesystem, credentials or native actions are exposed. */
export function consumeMobileBack(): boolean {
  const nativeDialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))
    .filter(visible)
    .at(-1);
  if (nativeDialog) {
    const cancel = new Event('cancel', { cancelable: true });
    if (nativeDialog.dispatchEvent(cancel)) nativeDialog.close();
    return true;
  }
  const modal = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
  )
    .filter(visible)
    .at(-1);
  const expanded = Array.from(
    (modal ?? document).querySelectorAll<HTMLDetailsElement>('details[open]'),
  )
    .filter(visible)
    .at(-1);
  if (expanded) {
    expanded.open = false;
    expanded.querySelector('summary')?.focus();
    return true;
  }
  if (modal) {
    const dismiss = modal.querySelector<HTMLButtonElement>('[data-mobile-back]:not(:disabled)');
    dismiss?.click();
    return true;
  }
  for (const item of [...handlers.values()].reverse().sort((a, b) => b.priority - a.priority))
    if (item.callback()) return true;
  return false;
}
function nativeBack(event: Event) {
  if (consumeMobileBack()) event.preventDefault();
}
export function registerMobileBack(callback: () => boolean, priority = 0) {
  const key = Symbol();
  if (!handlers.size) window.addEventListener('sekereagle:back', nativeBack);
  handlers.set(key, { callback, priority });
  return () => {
    handlers.delete(key);
    if (!handlers.size) window.removeEventListener('sekereagle:back', nativeBack);
  };
}
export function useMobileBack(callback: () => boolean, priority = 0, enabled = true) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(
    () => (enabled ? registerMobileBack(() => latest.current(), priority) : undefined),
    [priority, enabled],
  );
}
