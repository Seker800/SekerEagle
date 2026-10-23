import { useCallback, useLayoutEffect, useRef } from 'react';
import type { useEagleAssetViewport } from './eagle-asset-viewport';

type Item = { id: string; top: number; height: number };
/** Preserve an existing card's viewport position across a prepended, reflowing page. */
export function useEaglePrependAnchor(
  items: readonly Item[],
  viewport: ReturnType<typeof useEagleAssetViewport>,
  scope: string,
) {
  const anchor = useRef<null | { id: string; top: number; items: readonly Item[]; scope: string }>(
    null,
  );
  const capture = useCallback(() => {
    const top = viewport.elementRef.current?.scrollTop ?? 0;
    const item = items.find((item) => item.top + item.height > top);
    anchor.current = item ? { id: item.id, top: item.top, items, scope } : null;
  }, [items, viewport.elementRef, scope]);
  const clear = useCallback(() => {
    anchor.current = null;
  }, []);
  useLayoutEffect(() => {
    const saved = anchor.current;
    if (!saved) return;
    if (saved.scope !== scope) {
      clear();
      return;
    }
    // Entity normalization and append/resize renders can happen before the page commits.
    if (saved.items[0]?.id === items[0]?.id) return;
    clear();
    const item = items.find((item) => item.id === saved.id);
    const element = viewport.elementRef.current;
    if (!item || !element || item.top === saved.top) return;
    const top = Math.max(0, element.scrollTop + item.top - saved.top);
    element.scrollTo({ top, behavior: 'instant' });
    viewport.handleScroll(top);
  }, [items, scope, viewport.elementRef, viewport.handleScroll, clear]);
  return { capture, clear };
}
