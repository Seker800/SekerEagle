import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { DuplicateGroupSummary } from '../../lib/eagle-duplicates-api';
import { t } from '../../i18n';
import { EagleImageViewer } from './EagleImageViewer';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';
import { getEaglePreviewContentUrl } from './eagle-media-sources';
import type { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import type { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import styles from './EagleDuplicates.module.css';
export function EagleDuplicatePreview({
  group,
  index,
  selection,
  disabled,
  ignored,
  scheduler,
  loadService,
  scopeRevision,
  onKeep,
  onMore,
}: {
  group: DuplicateGroupSummary;
  index: number;
  selection?: { keepIds?: string[]; removeIds?: string[] };
  disabled: boolean;
  ignored: boolean;
  scheduler: MediaLoadScheduler;
  loadService: ThumbnailLoadService;
  scopeRevision: string;
  onKeep: (id: string) => void;
  onMore: () => void;
}) {
  const { ownerId, libraryMode, api } = useLibraryWorkspace();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const preview = previewIndex === null ? undefined : group.previews[previewIndex];
  const descriptor = useQuery({
    queryKey: [
      'eagle',
      ownerId,
      libraryMode,
      'duplicate-pyramid',
      scopeRevision,
      preview?.id,
      preview?.mediaRevision,
    ],
    enabled: !!preview,
    queryFn: ({ signal }) => api.getEaglePyramidDescriptor('', preview!.id, signal),
    retry: false,
  });
  const url = preview ? getEaglePreviewContentUrl(preview) : null;
  return (
    <div
      className={styles.directComparison}
      role="group"
      aria-label={t('重复组对比图 {{value1}}', { value1: index + 1 })}
    >
      {group.previews.map((asset, i) => {
        const kept = selection?.keepIds
          ? selection.keepIds.includes(asset.id)
          : selection?.removeIds
            ? !selection.removeIds.includes(asset.id)
            : group.recommendedId === asset.id;
        return (
          <article key={asset.id} className={`${styles.member} ${kept ? styles.kept : ''}`}>
            <button
              type="button"
              className={styles.previewImage}
              aria-label={t('放大比较 {{value1}}', { value1: asset.displayName })}
              onClick={() => setPreviewIndex(i)}
            >
              <EagleAssetThumbnail
                asset={asset}
                scheduler={scheduler}
                loadService={loadService}
                order={index * 4 + i}
                displayWidth={300}
              />
            </button>
            <div className={styles.memberBody}>
              <strong>{asset.originalName ?? asset.displayName}</strong>
              <span>
                {asset.format?.toUpperCase()} · {asset.width ?? '—'} × {asset.height ?? '—'} ·{' '}
                {((asset.byteSize ?? 0) / 1048576).toFixed(2)} MB
              </span>
              {asset.photoMetadata?.capturedAt && (
                <span>
                  {t('拍摄')} {new Date(asset.photoMetadata.capturedAt).toLocaleString()}
                </span>
              )}
              {!!asset.rating && <span>{'★'.repeat(asset.rating)}</span>}
              <button
                type="button"
                aria-label={t('保留 {{value1}}', { value1: asset.displayName })}
                aria-pressed={kept}
                disabled={ignored || disabled}
                onClick={() => onKeep(asset.id)}
              >
                {kept ? t('保留这张') : t('改为保留这张')}
              </button>
              {!kept && !ignored && <span>{t('移入回收站')}</span>}
            </div>
          </article>
        );
      })}
      {group.count > group.previews.length && group.previews.length > 0 && (
        <button type="button" onClick={onMore}>
          {t('查看其余 {{value1}} 张', { value1: group.count - group.previews.length })}
        </button>
      )}
      {preview && url && (
        <EagleImageViewer
          asset={preview}
          readOnly
          image={{ src: url, alt: preview.displayName, assetId: preview.id }}
          descriptor={descriptor.data ?? undefined}
          onClose={() => setPreviewIndex(null)}
          navigation={{
            previous: previewIndex! > 0 ? () => setPreviewIndex(previewIndex! - 1) : undefined,
            next:
              previewIndex! < group.previews.length - 1
                ? () => setPreviewIndex(previewIndex! + 1)
                : undefined,
            position: { current: previewIndex! + 1, total: group.previews.length },
          }}
        />
      )}
    </div>
  );
}
