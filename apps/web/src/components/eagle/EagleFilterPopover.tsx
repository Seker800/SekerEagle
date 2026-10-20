import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import styles from './EagleQuickFilterBar.module.css';

/** Escape overflow containers while retaining the trigger's live viewport position. */
export function EagleFilterPopover({
  children,
  anchor,
  panelRef,
  width = 310,
  onClose,
}: {
  children: ReactNode;
  anchor: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  width?: number;
  onClose: () => void;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({
    left: 8,
    top: 8,
    width,
    maxHeight: window.innerHeight - 16,
  });
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      const trigger = anchor.current;
      if (!trigger) return;
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0,
        y = viewport?.offsetTop ?? 0;
      const vw = viewport?.width ?? window.innerWidth,
        vh = viewport?.height ?? window.innerHeight;
      const rect = trigger.getBoundingClientRect();
      const panelWidth = Math.min(width, Math.max(0, vw - 16));
      const below = Math.max(0, y + vh - rect.bottom - 16);
      const above = Math.max(0, rect.top - y - 16);
      const useBelow = below >= Math.min(panel.scrollHeight, 240) || below >= above;
      const maxHeight = Math.max(0, Math.min(vh - 16, useBelow ? below : above));
      const height = Math.min(panel.getBoundingClientRect().height, maxHeight);
      const next = {
        left: Math.max(x + 8, Math.min(rect.left, x + vw - panelWidth - 8)),
        top: Math.max(
          y + 8,
          Math.min(useBelow ? rect.bottom + 7 : rect.top - height - 7, y + vh - height - 8),
        ),
        width: panelWidth,
        maxHeight,
      };
      setPosition((current) =>
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.maxHeight === next.maxHeight
          ? current
          : next,
      );
    };
    const scrolled = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) place();
    };
    place();
    panel.focus({ preventScroll: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(panel);
    if (anchor.current) observer?.observe(anchor.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scrolled, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scrolled, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, panelRef, width]);
  return createPortal(
    <div
      ref={panelRef}
      className={styles.floatingPanel}
      style={position}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close.current();
        anchor.current?.focus();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
