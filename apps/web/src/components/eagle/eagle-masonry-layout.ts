import { useCallback, useMemo, useRef, useState } from 'react';
import { layoutMasonryItems } from '../media/masonry-layout';

interface EagleMasonryAsset {
  id: string;
  width: number | null;
  height: number | null;
}

export interface EagleMasonryItem {
  id: string;
  column: number;
  left: number;
  top: number;
  width: number;
  height: number;
  previewHeight: number;
}

export interface EagleMasonrySection {
  id: string;
  key: string;
  column: number;
  top: number;
  width: number;
  height: number;
}

export interface EagleMasonryLayout {
  sections: EagleMasonrySection[];
  columns: number;
  height: number;
  items: EagleMasonryItem[];
}

const DESKTOP_MIN_CARD_WIDTH = 210;
const COMPACT_MIN_CARD_WIDTH = 145;
const DESKTOP_GAP = 13;
const COMPACT_GAP = 8;
const PREVIEW_MIN_HEIGHT = 105;
const PREVIEW_MAX_HEIGHT = 360;
const CARD_BORDER_HEIGHT = 2;

export interface EagleMasonryLayoutOptions {
  strategy?: 'masonry' | 'justified';
  targetCardWidth?: number;
  sectionKeys?: ReadonlyMap<string, string>;
}

export function buildEagleMasonryLayout(
  assets: EagleMasonryAsset[],
  containerWidth: number,
  options: EagleMasonryLayoutOptions = {},
): EagleMasonryLayout {
  if (options.strategy === 'justified')
    return buildJustifiedLayout(
      assets,
      containerWidth,
      options.targetCardWidth ?? 210,
      options.sectionKeys,
    );
  const safeWidth = Math.max(1, containerWidth);
  const compact = safeWidth < 560;
  const gap = compact ? COMPACT_GAP : DESKTOP_GAP;
  const fallbackCardWidth = compact ? COMPACT_MIN_CARD_WIDTH : DESKTOP_MIN_CARD_WIDTH;
  const requestedCardWidth = Math.max(1, options.targetCardWidth ?? fallbackCardWidth);
  const minCardWidth = compact ? Math.min(requestedCardWidth, 180) : requestedCardWidth;
  const columns = Math.max(1, Math.floor((safeWidth + gap) / (minCardWidth + gap)));
  const cardWidth = (safeWidth - gap * (columns - 1)) / columns;
  const contentWidth = Math.max(1, cardWidth - 2);
  const placementContentWidth = Math.max(1, minCardWidth - 2);
  const layout = layoutMasonryItems(
    assets.map((asset) => {
      const ratio = asset.width && asset.height ? asset.height / asset.width : 3 / 4;
      const previewHeight = Math.min(
        PREVIEW_MAX_HEIGHT,
        Math.max(PREVIEW_MIN_HEIGHT, contentWidth * ratio),
      );
      const placementPreviewHeight = Math.min(
        PREVIEW_MAX_HEIGHT,
        Math.max(PREVIEW_MIN_HEIGHT, placementContentWidth * ratio),
      );
      return {
        id: asset.id,
        width: cardWidth,
        height: previewHeight + CARD_BORDER_HEIGHT,
        placementHeight: placementPreviewHeight + CARD_BORDER_HEIGHT,
      };
    }),
    { containerWidth: safeWidth, columnCount: columns, gap },
  );
  const items = layout.items.map((item) => ({
    id: item.id,
    column: item.column,
    left: item.column * (cardWidth + gap),
    top: item.top,
    width: cardWidth,
    height: item.height,
    previewHeight: item.height - CARD_BORDER_HEIGHT,
  }));

  return {
    columns,
    sections: [],
    height: items.length ? Math.max(...layout.columnHeights) - gap : 0,
    items,
  };
}

export function useEagleMasonryLayout(
  assets: EagleMasonryAsset[],
  options: EagleMasonryLayoutOptions = {},
) {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(DESKTOP_MIN_CARD_WIDTH);

  const containerRef = useCallback((container: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!container) return;

    const updateWidth = (width: number) => {
      const normalizedWidth = Math.round(width);
      if (normalizedWidth > 0) {
        setContainerWidth((current) => (current === normalizedWidth ? current : normalizedWidth));
      }
    };
    updateWidth(container.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(([entry]) => updateWidth(entry.contentRect.width));
    observer.observe(container);
    observerRef.current = observer;
  }, []);

  return {
    containerRef,
    layout: useMemo(
      () => buildEagleMasonryLayout(assets, containerWidth, options),
      [assets, containerWidth, options.targetCardWidth, options.strategy, options.sectionKeys],
    ),
  };
}

function buildJustifiedLayout(
  assets: EagleMasonryAsset[],
  width: number,
  target: number,
  sectionKeys?: ReadonlyMap<string, string>,
): EagleMasonryLayout {
  const safeWidth = Math.max(3, width);
  const targetHeight = Math.max(60, Math.min(360, target));
  const gap = 4;
  const items: EagleMasonryItem[] = [];
  const sections: EagleMasonrySection[] = [];
  let previousSection: string | undefined;
  let row: Array<{ asset: EagleMasonryAsset; ratio: number }> = [];
  let ratios = 0,
    top = 0,
    columns = 0;
  const flush = (last: boolean) => {
    if (!row.length) return;
    const contentWidth = Math.max(1, safeWidth - gap * (row.length - 1) - 2 * row.length);
    const height = last ? Math.min(targetHeight, contentWidth / ratios) : contentWidth / ratios;
    let left = 0;
    row.forEach(({ asset, ratio }, column) => {
      const itemWidth = ratio * height + 2;
      items.push({
        id: asset.id,
        column,
        left,
        top,
        width: itemWidth,
        height: height + 2,
        previewHeight: height,
      });
      left += itemWidth + gap;
    });
    columns = Math.max(columns, row.length);
    top += height + 2 + gap;
    row = [];
    ratios = 0;
  };
  for (const asset of assets) {
    const key = sectionKeys?.get(asset.id);
    if (key !== previousSection) {
      flush(true);
      if (key !== undefined) {
        const height = 52;
        sections.push({ id: `section:${asset.id}`, key, column: 0, top, width: safeWidth, height });
        top += height;
      }
      previousSection = key;
    }
    const rawRatio = asset.width && asset.height ? asset.width / asset.height : 4 / 3;
    const ratio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 4 / 3;
    row.push({ asset, ratio });
    ratios += ratio;
    if (ratios * targetHeight + 2 * row.length + gap * (row.length - 1) >= safeWidth) flush(false);
  }
  flush(true);
  return { items, sections, columns, height: items.length ? top - gap : 0 };
}
