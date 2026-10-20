import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { t } from '../../../i18n';
import styles from './PhotoEditor.module.css';

/** Native touch scrolling, plus explicit paging and mouse dragging on desktop. */
export function ScrollableToolRow({
  children,
  className,
  label,
  viewportRef,
  onScroll,
  onNavigate,
  anchorSelector,
}: {
  children: ReactNode;
  className: string;
  label: string;
  viewportRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (viewport: HTMLDivElement) => void;
  onNavigate?: () => void;
  anchorSelector?: string;
}) {
  const localViewport = useRef<HTMLDivElement>(null);
  const viewport = viewportRef ?? localViewport;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const drag = useRef({ x: 0, left: 0, active: false, moved: false });
  const [trailingSpace, setTrailingSpace] = useState(0);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      if (anchorSelector) {
        const anchor = Array.from(element.querySelectorAll<HTMLElement>(anchorSelector)).at(-1);
        const last = Array.from(element.querySelectorAll<HTMLElement>(':scope > button')).at(-1);
        if (anchor && last) {
          const remaining =
            last.getBoundingClientRect().right - anchor.getBoundingClientRect().left;
          setTrailingSpace(Math.max(0, element.clientWidth - remaining));
        }
      }
      const left = element.scrollLeft > 1;
      const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) navigateRef.current?.();
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const end = element.scrollWidth - element.clientWidth;
      if (end <= 1 || (event.deltaY < 0 ? element.scrollLeft <= 0 : element.scrollLeft >= end - 1))
        return;
      event.preventDefault();
      element.scrollLeft +=
        event.deltaY *
        (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element.clientWidth : 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const observeChildren = () => {
      observer.disconnect();
      observer.observe(element);
      for (const child of element.children) observer.observe(child);
      measure();
    };
    const mutations = new MutationObserver(observeChildren);
    mutations.observe(element, { childList: true, subtree: true });
    observeChildren();
    element.addEventListener('scroll', measure);
    element.addEventListener('wheel', wheel, { passive: false });
    measure();
    return () => {
      mutations.disconnect();
      observer.disconnect();
      element.removeEventListener('scroll', measure);
      element.removeEventListener('wheel', wheel);
    };
  }, [viewport, anchorSelector]);
  const page = (direction: number) => {
    onNavigate?.();
    const element = viewport.current;
    if (element)
      element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div className={styles.toolScrollFrame}>
      <button
        type="button"
        className={styles.toolScrollArrow}
        aria-label={`${label} · ${t('向左滚动')}`}
        disabled={!edges.left}
        hidden={!edges.left && !edges.right}
        onClick={() => page(-1)}
      >
        <IconChevronLeft size={17} />
      </button>
      <div
        ref={viewport}
        role="group"
        aria-label={label}
        tabIndex={0}
        data-anchor-navigation={anchorSelector ? true : undefined}
        onScroll={(event) => onScroll?.(event.currentTarget)}
        className={`${className} ${styles.toolScrollViewport}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            page(event.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
        onPointerDown={(event) => {
          onNavigate?.();
          if (event.pointerType !== 'mouse' || event.button !== 0) return;
          drag.current = {
            x: event.clientX,
            left: event.currentTarget.scrollLeft,
            active: true,
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          if (!drag.current.active) return;
          if (event.buttons !== 1) {
            drag.current.active = false;
            return;
          }
          const distance = event.clientX - drag.current.x;
          if (!drag.current.moved && Math.abs(distance) < 6) return;
          drag.current.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.scrollLeft = drag.current.left - distance;
          event.preventDefault();
        }}
        onPointerUp={() => {
          drag.current.active = false;
        }}
        onLostPointerCapture={() => {
          drag.current.active = false;
        }}
        onPointerCancel={() => {
          drag.current.active = false;
          drag.current.moved = false;
        }}
        onClickCapture={(event) => {
          if (!drag.current.moved) return;
          drag.current.moved = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
        {anchorSelector && (
          <span
            className={styles.toolScrollTail}
            aria-hidden="true"
            style={{ flexBasis: trailingSpace }}
          />
        )}
      </div>
      <button
        type="button"
        className={styles.toolScrollArrow}
        aria-label={`${label} · ${t('向右滚动')}`}
        disabled={!edges.right}
        hidden={!edges.left && !edges.right}
        onClick={() => page(1)}
      >
        <IconChevronRight size={17} />
      </button>
    </div>
  );
}
