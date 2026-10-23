import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { t } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { getPhotoMapPhotos, type PhotoMapCluster } from '../../lib/photo-management-api';
import { EagleAssetThumbnail } from '../eagle/EagleAssetThumbnail';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import styles from './PhotoMap.module.css';

/** A bounded page of members; media loading and the photo viewer remain shared. */
export function PhotoMapPhotos({
  cluster,
  placeName,
  ownerId,
  includePrivate,
  onOpen,
  onClose,
}: {
  cluster: PhotoMapCluster;
  placeName?: string;
  ownerId: string | null;
  includePrivate: boolean;
  onOpen: (asset: EagleAssetListItem, context?: EagleAssetListItem[]) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const scheduler = useMemo(() => new MediaLoadScheduler(), []);
  const loadService = useMemo(() => new ThumbnailLoadService(), []);
  useEffect(
    () => () => {
      scheduler.clear({ abortActive: true });
      loadService.dispose();
    },
    [scheduler, loadService],
  );
  const page = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'map-photos', includePrivate, cluster.id, cursors.at(-1)],
    queryFn: ({ signal }) => getPhotoMapPhotos(cluster.id, cursors.at(-1), signal),
    staleTime: 30000,
  });
  return (
    <section ref={panel} className={styles.selection} aria-label={t('此位置的照片')}>
      <div className={styles.heading}>
        <div>
          <h2>{placeName || t('此位置的照片')}</h2>
          <p>{t('约 {{value1}} 张 · 按拍摄时间排序', { value1: cluster.count })}</p>
        </div>
        <button type="button" onClick={onClose}>
          {t('关闭')}
        </button>
      </div>
      {page.isPending && <p role="status">{t('正在加载照片…')}</p>}
      {page.isError && (
        <p role="alert">
          {t('位置照片加载失败。')}{' '}
          <button type="button" onClick={() => void page.refetch()}>
            {t('重试')}
          </button>
        </p>
      )}
      <div className={styles.photos}>
        {page.data?.items.map((asset, index) => (
          <button
            type="button"
            key={asset.id}
            onClick={() => onOpen(asset, page.data?.items)}
            title={asset.displayName}
            aria-label={asset.displayName}
          >
            <EagleAssetThumbnail
              asset={asset}
              scheduler={scheduler}
              loadService={loadService}
              order={index}
              displayWidth={180}
            />
          </button>
        ))}
      </div>
      {page.data && page.data.items.length === 0 && <p>{t('此位置暂无可见照片。')}</p>}
      <nav className={styles.pages} aria-label={t('位置照片翻页')}>
        <button
          type="button"
          disabled={cursors.length === 1 || page.isFetching}
          onClick={() => setCursors((current) => current.slice(0, -1))}
        >
          {t('上一页')}
        </button>
        <span>{t('第 {{value1}} 页', { value1: cursors.length })}</span>
        <button
          type="button"
          disabled={!page.data?.nextCursor || page.isFetching}
          onClick={() => {
            const next = page.data?.nextCursor;
            if (next) setCursors((current) => [...current, next]);
          }}
        >
          {t('下一页')}
        </button>
      </nav>
    </section>
  );
}
