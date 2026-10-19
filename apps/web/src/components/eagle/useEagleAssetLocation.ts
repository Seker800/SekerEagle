import { useCallback, useEffect, useRef, useState } from 'react';
import type { EagleAssetLocation } from '../../lib/eagle-api';
import type { useEagleAssetViewport } from './eagle-asset-viewport';

export function useEagleAssetLocation({
  getLocation,
  scopeKey,
  onLocated,
}: {
  getLocation: (
    token: string,
    assetId: string,
    signal?: AbortSignal,
  ) => Promise<EagleAssetLocation>;
  scopeKey: string;
  onLocated: () => void;
}) {
  const [location, setLocation] = useState<EagleAssetLocation | null>(null);
  const request = useRef<AbortController | null>(null);
  const onLocatedRef = useRef(onLocated);
  useEffect(() => {
    onLocatedRef.current = onLocated;
  }, [onLocated]);
  const clearLocation = useCallback(() => {
    request.current?.abort();
    setLocation(null);
  }, []);
  useEffect(() => {
    clearLocation();
    return () => request.current?.abort();
  }, [scopeKey, clearLocation]);
  const locate = useCallback(
    async (assetId: string) => {
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      try {
        const next = await getLocation('', assetId, controller.signal);
        if (controller.signal.aborted) return;
        setLocation(next);
        onLocatedRef.current();
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    },
    [getLocation],
  );
  return { location, locate, clearLocation };
}

/** Scroll by layout coordinates first, then focus after the virtualized card mounts. */
export function useEagleAssetLocationFocus({
  location,
  targetId,
  items,
  viewport,
  enabled,
  onSelect,
}: {
  location: EagleAssetLocation | null;
  targetId: string | undefined;
  items: ReadonlyArray<{ id: string; top: number; height: number }>;
  viewport: ReturnType<typeof useEagleAssetViewport>;
  enabled: boolean;
  onSelect: (id: string) => void;
}) {
  const positioned = useRef<EagleAssetLocation | null>(null);
  const focused = useRef<EagleAssetLocation | null>(null);
  useEffect(() => {
    if (!enabled || !location || !targetId || viewport.viewportHeight <= 0) return;
    const item = items.find(({ id }) => id === targetId);
    if (!item || !viewport.elementRef.current) return;
    if (positioned.current !== location) {
      positioned.current = location;
      const top = Math.max(0, item.top - (viewport.viewportHeight - item.height) / 2);
      viewport.elementRef.current.scrollTo({ top, behavior: 'instant' });
      viewport.handleScroll(top);
      onSelect(targetId);
    }
    if (focused.current === location) return;
    const frame = requestAnimationFrame(() => {
      const card = Array.from(
        viewport.elementRef.current?.querySelectorAll<HTMLButtonElement>('[data-asset-id]') ?? [],
      ).find((element) => element.dataset.assetId === targetId);
      if (card) {
        card.focus({ preventScroll: true });
        focused.current = location;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, location, targetId, items, viewport, onSelect]);
}
