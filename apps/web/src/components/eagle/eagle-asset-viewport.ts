import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useEagleAssetViewport(scope = 'default', positions?: Map<string, number>) {
  const localPositions = useRef(new Map<string, number>());
  const savedPositions = positions ?? localPositions.current;
  const restorePending = useRef(true);
  const elementRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const cancelPendingScroll = useCallback(() => {
    if (scrollFrameRef.current === null) return;
    cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = null;
  }, []);

  const containerRef = useCallback(
    (container: HTMLDivElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      cancelPendingScroll();
      if (!container && elementRef.current) {
        savedPositions.delete(scope);
        savedPositions.set(scope, elementRef.current.scrollTop);
        if (savedPositions.size > 32) savedPositions.delete(savedPositions.keys().next().value!);
      }
      elementRef.current = container;
      restorePending.current = true;
      pendingScrollTopRef.current = savedPositions.get(scope) ?? 0;
      setScrollTop(pendingScrollTopRef.current);
      if (!container) return;

      const updateHeight = (height: number) => {
        const normalizedHeight = Math.round(height);
        if (normalizedHeight > 0) {
          setViewportHeight((current) =>
            current === normalizedHeight ? current : normalizedHeight,
          );
        }
      };
      updateHeight(container.getBoundingClientRect().height);
      if (typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(([entry]) => updateHeight(entry.contentRect.height));
      observer.observe(container);
      observerRef.current = observer;
    },
    [cancelPendingScroll, savedPositions, scope],
  );

  // Run after child layout so the browser can restore against the full cached list.
  useLayoutEffect(() => {
    const container = elementRef.current;
    if (!container || !restorePending.current) return;
    container.scrollTop = savedPositions.get(scope) ?? 0;
    if (container.scrollTop === (savedPositions.get(scope) ?? 0)) restorePending.current = false;
    setScrollTop(container.scrollTop);
  });

  const handleScroll = useCallback((nextScrollTop: number) => {
    restorePending.current = false;
    pendingScrollTopRef.current = nextScrollTop;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = -1;
    const frame = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(pendingScrollTopRef.current);
    });
    if (scrollFrameRef.current !== null) scrollFrameRef.current = frame;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      cancelPendingScroll();
    },
    [cancelPendingScroll, savedPositions, scope],
  );

  return { containerRef, elementRef, handleScroll, scrollTop, viewportHeight };
}
