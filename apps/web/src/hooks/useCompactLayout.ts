import { useSyncExternalStore } from 'react';
export const COMPACT_LAYOUT_QUERY = '(max-width: 720px)';
const snapshot = () => window.matchMedia?.(COMPACT_LAYOUT_QUERY).matches ?? false;
const subscribe = (changed: () => void) => {
  const media = window.matchMedia?.(COMPACT_LAYOUT_QUERY);
  media?.addEventListener('change', changed);
  return () => media?.removeEventListener('change', changed);
};
/** Shared interaction breakpoint, independent of library mode or platform. */
export function useCompactLayout() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
