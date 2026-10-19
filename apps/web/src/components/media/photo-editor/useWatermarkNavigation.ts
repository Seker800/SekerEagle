import { useCallback, useEffect, useRef, useState } from 'react';
import {
  findWatermark,
  WATERMARK_CATEGORIES,
  WATERMARK_TEMPLATES,
  type WatermarkCategory,
} from './photo-watermark-model';

// Keep every category contiguous even if the source catalog is later reordered.
export const ORDERED_WATERMARK_TEMPLATES = WATERMARK_CATEGORIES.flatMap((category) =>
  WATERMARK_TEMPLATES.filter((template) => template.category === category.id),
);

/** Category shortcuts navigate one continuous strip; navigation never changes the selected layout. */
export function useWatermarkNavigation(watermark: string) {
  const [group, setGroup] = useState<WatermarkCategory>(
    findWatermark(watermark)?.category ?? 'photo',
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const templates = useRef(new Map<string, HTMLButtonElement>());
  const manual = useRef(false);
  const templateRef = (id: string) => (element: HTMLButtonElement | null) => {
    if (element) templates.current.set(id, element);
    else templates.current.delete(id);
  };
  useEffect(() => {
    manual.current = false;
    setGroup(findWatermark(watermark)?.category ?? 'photo');
    templates.current.get(watermark)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [watermark]);
  useEffect(() => {
    categoryRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [group]);
  const selectCategory = useCallback((category: WatermarkCategory) => {
    // At wide sizes several anchors clamp to the same scroll position. Keep the user's
    // requested category active until another user scroll, rather than guessing from that position.
    manual.current = false;
    setGroup(category);
    const viewport = viewportRef.current;
    const first = ORDERED_WATERMARK_TEMPLATES.find((template) => template.category === category);
    const button = first && templates.current.get(first.id);
    if (viewport && button)
      viewport.scrollTo({
        left:
          viewport.scrollLeft +
          button.getBoundingClientRect().left -
          viewport.getBoundingClientRect().left,
        behavior: 'smooth',
      });
  }, []);
  const beginNavigation = useCallback(() => {
    manual.current = true;
  }, []);
  const followScroll = useCallback((viewport: HTMLDivElement) => {
    if (!manual.current || viewport.scrollWidth <= viewport.clientWidth + 1) return;
    if (viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1) {
      setGroup(WATERMARK_CATEGORIES[WATERMARK_CATEGORIES.length - 1].id);
      return;
    }
    const left = viewport.getBoundingClientRect().left + 8;
    const leading = ORDERED_WATERMARK_TEMPLATES.find((template) => {
      const button = templates.current.get(template.id);
      return button && button.getBoundingClientRect().right > left;
    });
    if (leading) setGroup(leading.category);
  }, []);
  return {
    group,
    viewportRef,
    categoryRef,
    templateRef,
    selectCategory,
    beginNavigation,
    followScroll,
  };
}
