import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
interface Item {
  id: string;
  group: string;
  anchor?: boolean;
}
/** Navigate a continuous tool strip without editing the selected tool or its parameters. */
export function useToolGroupNavigation(items: readonly Item[], selected: string) {
  const groups = useMemo(() => [...new Set(items.map((item) => item.group))], [items]);
  const [group, setGroup] = useState(
    items.find((item) => item.id === selected)?.group ?? groups[0],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const manual = useRef(false);
  const itemRef = (id: string) => (element: HTMLButtonElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  };
  useEffect(() => {
    manual.current = false;
    setGroup(items.find((item) => item.id === selected)?.group ?? groups[0]);
    elements.current.get(selected)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [items, selected, groups]);
  useEffect(() => {
    categoryRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [group]);
  const selectGroup = useCallback(
    (next: string) => {
      manual.current = false;
      setGroup(next);
      const viewport = viewportRef.current,
        first = items.find((item) => item.group === next && item.anchor !== false);
      const button = first && elements.current.get(first.id);
      if (viewport && button)
        viewport.scrollTo({
          left:
            viewport.scrollLeft +
            button.getBoundingClientRect().left -
            viewport.getBoundingClientRect().left,
          behavior: 'smooth',
        });
    },
    [items],
  );
  const beginNavigation = useCallback(() => {
    manual.current = true;
  }, []);
  const followScroll = useCallback(
    (viewport: HTMLDivElement) => {
      if (!manual.current || viewport.scrollWidth <= viewport.clientWidth + 1) return;
      if (viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1) {
        setGroup(groups[groups.length - 1]);
        return;
      }
      const left = viewport.getBoundingClientRect().left + 8;
      const leading = items.find((item) => {
        const button = elements.current.get(item.id);
        return button && button.getBoundingClientRect().right > left;
      });
      if (leading) setGroup(leading.group);
    },
    [groups, items],
  );
  return { group, viewportRef, categoryRef, itemRef, selectGroup, beginNavigation, followScroll };
}
