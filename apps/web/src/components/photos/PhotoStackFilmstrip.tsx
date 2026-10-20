import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconChevronLeft, IconChevronRight, IconPhoto, IconStarFilled } from '@tabler/icons-react';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { EagleAssetListItem, EaglePhotoStack } from '../../lib/eagle-api';
import { getEagleRenditionContentUrl } from '../../lib/eagle-api';
import { t } from '../../i18n';
import styles from './PhotoStackFilmstrip.module.css';
export const stackAssetKey = (ownerId: string, assetId: string) =>
  ['eagle', ownerId, 'PHOTO', 'stack-asset', assetId] as const;
export function PhotoStackFilmstrip({
  stack,
  selectedId,
  onSelect,
}: {
  stack: EaglePhotoStack;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const viewport = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const selected = viewport.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    selected?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);
  const page = (direction: number) =>
    viewport.current?.scrollBy({
      left: direction * viewport.current.clientWidth * 0.75,
      behavior: 'smooth',
    });
  return (
    <div className={styles.root}>
      <button
        className={styles.page}
        type="button"
        aria-label={t('向左滚动照片组')}
        onClick={() => page(-1)}
      >
        <IconChevronLeft size={18} />
      </button>
      <ol
        ref={viewport}
        className={styles.strip}
        aria-label={t('照片组缩略图')}
        onKeyDown={(event) => {
          const index = stack.assetIds.indexOf(selectedId);
          const next =
            event.key === 'ArrowLeft'
              ? Math.max(0, index - 1)
              : event.key === 'ArrowRight'
                ? Math.min(stack.assetIds.length - 1, index + 1)
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? stack.assetIds.length - 1
                    : -1;
          if (next < 0) return;
          event.preventDefault();
          event.stopPropagation();
          const id = stack.assetIds[next];
          if (id) {
            onSelect(id);
            viewport.current?.querySelectorAll('button')[next]?.focus();
          }
        }}
      >
        {stack.assetIds.map((id, index) => (
          <StackThumbnail
            key={id}
            id={id}
            index={index}
            selected={id === selectedId}
            best={id === stack.bestAssetId}
            cover={stack.cover}
            viewport={viewport}
            onSelect={onSelect}
          />
        ))}
      </ol>
      <button
        className={styles.page}
        type="button"
        aria-label={t('向右滚动照片组')}
        onClick={() => page(1)}
      >
        <IconChevronRight size={18} />
      </button>
    </div>
  );
}
function StackThumbnail({
  id,
  index,
  selected,
  best,
  cover,
  viewport,
  onSelect,
}: {
  id: string;
  index: number;
  selected: boolean;
  best: boolean;
  cover: EagleAssetListItem;
  viewport: RefObject<HTMLOListElement | null>;
  onSelect: (id: string) => void;
}) {
  const { ownerId, api } = useLibraryWorkspace();
  const button = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!button.current || visible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: viewport.current, rootMargin: '0px 160px' },
    );
    observer.observe(button.current);
    return () => observer.disconnect();
  }, [visible, viewport]);
  const query = useQuery({
    queryKey: stackAssetKey(ownerId, id),
    queryFn: () => api.getEagleAsset('', id),
    enabled: id !== cover.id && (visible || selected),
  });
  const asset = id === cover.id ? cover : query.data;
  const thumbnail = asset?.renditions
    .filter(
      (row) =>
        row.kind === 'THUMBNAIL' &&
        row.revision === asset.mediaRevision &&
        (!row.mimeType || row.mimeType.startsWith('image/')),
    )
    .sort((a, b) => (a.width ?? Infinity) - (b.width ?? Infinity))[0];
  const src = thumbnail
    ? getEagleRenditionContentUrl(id, thumbnail.id, thumbnail.kind, 'PHOTO')
    : undefined;
  return (
    <li className={styles.item}>
      <button
        ref={button}
        type="button"
        aria-label={t('查看第 {{value1}} 张照片', { value1: index + 1 })}
        aria-pressed={selected}
        tabIndex={selected ? 0 : -1}
        title={asset?.displayName}
        onClick={() => onSelect(id)}
      >
        {src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <IconPhoto size={20} />}
        <span className={styles.number}>{index + 1}</span>
        {asset?.photoMetadata && (
          <span className={styles.version}>
            {asset.photoMetadata.captureMetadataInherited ? t('已编辑') : t('原片')}
          </span>
        )}
        {best && (
          <span className={styles.best} aria-label={t('当前主图')}>
            <IconStarFilled size={11} />
          </span>
        )}
      </button>
    </li>
  );
}
