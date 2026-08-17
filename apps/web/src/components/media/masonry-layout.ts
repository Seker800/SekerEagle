export interface MasonrySourceItem {
  id: string;
  width: number;
  height: number;
  /** Optional width-independent height used only to choose the shortest column. */
  placementHeight?: number;
}

export interface MasonryLayoutItem extends MasonrySourceItem {
  column: number;
  height: number;
  top: number;
}

export interface MasonryViewportIndex<T extends MasonryLayoutItem> {
  bucketSize: number;
  buckets: ReadonlyMap<number, readonly T[]>;
}

export function getResponsiveMasonryColumnCount(width: number): number {
  if (width < 640) return 2;
  if (width < 960) return 3;
  if (width < 1320) return 4;
  return 5;
}

export function layoutMasonryItems<T extends MasonrySourceItem>(
  items: readonly T[],
  options: { containerWidth: number; columnCount: number; gap: number },
) {
  const { containerWidth, gap } = options;
  const columnCount = Math.max(1, options.columnCount);
  const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
  const columnHeights = Array.from({ length: columnCount }, () => 0);
  const placementColumnHeights = Array.from({ length: columnCount }, () => 0);
  const layoutItems = items.map((item) => {
    const column = placementColumnHeights.indexOf(Math.min(...placementColumnHeights));
    const height = Math.max(1, Math.round((columnWidth * item.height) / item.width));
    const placementHeight = Math.max(1, Math.round(item.placementHeight ?? height));
    const top = columnHeights[column];
    columnHeights[column] += height + gap;
    placementColumnHeights[column] += placementHeight + gap;
    return { ...item, column, height, top };
  });
  return { columnWidth, columnHeights, items: layoutItems };
}

export function selectVisibleMasonryItems<T extends MasonryLayoutItem>(
  items: readonly T[],
  options: { scrollTop: number; viewportHeight: number; overscan: number },
): T[] {
  const scrollTop = Number.isFinite(options.scrollTop) ? options.scrollTop : 0;
  const viewportHeight =
    Number.isFinite(options.viewportHeight) && options.viewportHeight > 0
      ? options.viewportHeight
      : 800;
  const overscan = Number.isFinite(options.overscan) ? Math.max(0, options.overscan) : 1_200;
  const minimumTop = Math.max(0, scrollTop - overscan);
  const maximumBottom = scrollTop + viewportHeight + overscan;
  return items.filter((item) => item.top + item.height >= minimumTop && item.top <= maximumBottom);
}

export function buildMasonryViewportIndex<T extends MasonryLayoutItem>(
  items: readonly T[],
  bucketSize = 1_000,
): MasonryViewportIndex<T> {
  const safeBucketSize = Math.max(100, bucketSize);
  const buckets = new Map<number, T[]>();
  items.forEach((item) => {
    const firstBucket = Math.floor(item.top / safeBucketSize);
    const lastBucket = Math.floor((item.top + item.height) / safeBucketSize);
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const entries = buckets.get(bucket) ?? [];
      entries.push(item);
      buckets.set(bucket, entries);
    }
  });
  return { bucketSize: safeBucketSize, buckets };
}

export function selectVisibleMasonryItemsFromIndex<T extends MasonryLayoutItem>(
  index: MasonryViewportIndex<T>,
  options: { scrollTop: number; viewportHeight: number; overscan: number },
): T[] {
  const scrollTop = Number.isFinite(options.scrollTop) ? options.scrollTop : 0;
  const viewportHeight =
    Number.isFinite(options.viewportHeight) && options.viewportHeight > 0
      ? options.viewportHeight
      : 800;
  const overscan = Number.isFinite(options.overscan) ? Math.max(0, options.overscan) : 1_200;
  const minimumTop = Math.max(0, scrollTop - overscan);
  const maximumBottom = scrollTop + viewportHeight + overscan;
  const firstBucket = Math.floor(minimumTop / index.bucketSize);
  const lastBucket = Math.floor(maximumBottom / index.bucketSize);
  const candidates = new Map<string, T>();
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
    index.buckets.get(bucket)?.forEach((item) => candidates.set(item.id, item));
  }
  return [...candidates.values()]
    .filter((item) => item.top + item.height >= minimumTop && item.top <= maximumBottom)
    .sort((left, right) => left.top - right.top);
}
