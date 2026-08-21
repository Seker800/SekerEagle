import { useCallback, useEffect, useRef, useState } from 'react';

export function useEagleAssetViewport() {
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
      elementRef.current = container;
      pendingScrollTopRef.current = container?.scrollTop ?? 0;
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
    [cancelPendingScroll],
  );

  const handleScroll = useCallback((nextScrollTop: number) => {
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
    [cancelPendingScroll],
  );

  return { containerRef, elementRef, handleScroll, scrollTop, viewportHeight };
}
