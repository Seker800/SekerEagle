import { EagleFavoriteButton } from './EagleFavoriteButton';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { mobileViewerPresentation } from './EagleMobileViewer';
import { isCameraVideoMime } from '@sekereagle/library-core';
import type { ReactNode } from 'react';
import type { EagleAssetListItem, EaglePyramidDescriptor } from '../../lib/eagle-api';
import { t } from '../../i18n';
import {
  getEagleEditContentUrl,
  getEaglePreviewContentUrl,
  getEagleVideoContentUrl,
  getEagleLivePhotoContentUrl,
} from './eagle-media-sources';
import { EagleViewerShell, eagleViewerMetadata } from './EagleViewerShell';
import { EagleImageViewer } from './EagleImageViewer';
import { EagleLocateAssetButton } from './EagleLocateAssetButton';
import { eaglePhotoEditLabel } from './EaglePhotoEditing';
import styles from './EagleAssetLightbox.module.css';
interface EagleAssetLightboxProps {
  asset: EagleAssetListItem;
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  actions?: ReactNode;
  collection?: ReactNode;
  descriptor?: EaglePyramidDescriptor;
  navigation?: { index: number; count: number; onPrevious: () => void; onNext: () => void };
  onClose: () => void;
  onLocate?: (assetId: string) => Promise<void>;
  onEdit?: (asset: EagleAssetListItem) => void;
}
export function EagleAssetLightbox({
  asset,
  onClose,
  onLocate,
  onEdit,
  navigation,
  actions,
  collection,
  loading = false,
  loadError,
  onRetry,
  descriptor,
}: EagleAssetLightboxProps) {
  const compact = useCompactLayout();
  const previewUrl = getEaglePreviewContentUrl(asset);
  const navigationProps = navigation
    ? {
        previous: navigation.onPrevious,
        next: navigation.onNext,
        position: { current: navigation.index + 1, total: navigation.count },
      }
    : undefined;
  if (asset.mimeType.startsWith('image/') && previewUrl)
    return (
      <EagleImageViewer
        asset={asset}
        readOnly={Boolean(asset.deletedAt)}
        image={{
          src: previewUrl,
          alt: asset.displayName,
          assetId: asset.id,
          motionSrc: getEagleLivePhotoContentUrl(asset),
        }}
        descriptor={descriptor}
        subtitle={eagleViewerMetadata(asset)}
        loading={loading}
        error={loadError}
        onRetry={onRetry}
        onClose={onClose}
        onLocate={onLocate}
        onEdit={onEdit && getEagleEditContentUrl(asset) ? () => onEdit(asset) : undefined}
        editLabel={eaglePhotoEditLabel(asset) ?? undefined}
        navigation={navigationProps}
        actions={actions}
        collection={collection}
      />
    );
  const videoUrl = getEagleVideoContentUrl(asset);
  return (
    <EagleViewerShell
      mobile={
        compact
          ? mobileViewerPresentation(
              asset,
              onClose,
              undefined,
              actions,
              undefined,
              Boolean(asset.deletedAt) || loading,
            )
          : undefined
      }
      title={loading ? t('正在加载…') : asset.displayName}
      subtitle={loading ? undefined : eagleViewerMetadata(asset)}
      navigation={navigationProps}
      onClose={onClose}
      collection={collection}
      actions={
        <>
          <EagleFavoriteButton
            assets={[asset]}
            disabled={Boolean(asset.deletedAt) || loading || Boolean(loadError)}
          />
          {!loading && !loadError && onLocate && (
            <EagleLocateAssetButton assetId={asset.id} onLocate={onLocate} />
          )}
          {actions}
        </>
      }
    >
      <div className={styles.content}>
        {loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            {onRetry && (
              <button type="button" onClick={onRetry}>
                {t('重试')}
              </button>
            )}
          </div>
        ) : loading ? (
          <p role="status">{t('正在加载…')}</p>
        ) : isCameraVideoMime(asset.mimeType) && videoUrl ? (
          <video
            className={styles.videoPlayer}
            src={videoUrl}
            aria-label={t('播放 {{value1}}', { value1: asset.displayName })}
            controls
            autoPlay
            playsInline
          />
        ) : isCameraVideoMime(asset.mimeType) ? (
          <div>
            {previewUrl && (
              <img className={styles.videoPlayer} src={previewUrl} alt={asset.displayName} />
            )}
            <p>
              {asset.mediaErrorCode === 'VIDEO_PLAYBACK_FAILED'
                ? t('视频播放副本生成失败，原片已保存，可在处理任务中重试')
                : t('视频播放副本尚未生成，原片已保存')}
            </p>
          </div>
        ) : (
          <p>{t('预览图尚未生成')}</p>
        )}
      </div>
    </EagleViewerShell>
  );
}
