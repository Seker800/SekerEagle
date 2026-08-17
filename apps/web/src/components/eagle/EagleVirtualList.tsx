import { useLayoutEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';

interface EagleVirtualListProps<T> {
  ariaLabel: string;
  className: string;
  items: T[];
  itemKey: (item: T) => string;
  rowHeight: number;
  viewportHeight: number;
  renderItem: (item: T) => ReactNode;
}

const OVERSCAN_ROWS = 4;

export function EagleVirtualList<T>({
  ariaLabel,
  className,
  items,
  itemKey,
  rowHeight,
  viewportHeight,
  renderItem,
}: EagleVirtualListProps<T>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
  const lastRow = Math.min(items.length, firstRow + visibleRows);

  useLayoutEffect(() => {
    viewportRef.current?.scrollTo?.({ top: 0 });
    setScrollTop(0);
  }, [items]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div ref={viewportRef} className={className} aria-label={ariaLabel} onScroll={handleScroll}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(firstRow, lastRow).map((item, offset) => {
          const index = firstRow + offset;
          return (
            <div
              key={itemKey(item)}
              style={{
                height: rowHeight,
                left: 0,
                position: 'absolute',
                right: 0,
                top: index * rowHeight,
              }}
            >
              {renderItem(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
