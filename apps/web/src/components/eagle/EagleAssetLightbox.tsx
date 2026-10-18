import { isCameraVideoMime } from '@sekereagle/library-core';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconX } from '@tabler/icons-react';
import { type EagleAssetListItem } from '../../lib/eagle-api';
import { getEaglePreviewContentUrl, getEagleVideoContentUrl } from './eagle-media-sources';
import styles from './EagleAssetLightbox.module.css';
interface EagleAssetLightboxProps {
  asset: EagleAssetListItem;
  loading?: boolean;
  actions?: ReactNode;
  navigation?: { index: number; count: number; onPrevious: () => void; onNext: () => void };
  onClose: () => void;
}
export function EagleAssetLightbox({
  asset,
  onClose,
  navigation,
  actions,
  loading,
}: EagleAssetLightboxProps) {
  const { libraryMode } = useLibraryWorkspace();

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  const previewUrl = getEaglePreviewContentUrl(asset);
  const videoUrl = getEagleVideoContentUrl(asset);
  return (
    <div
      ref={dialogRef}
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={libraryMode === 'PHOTO' ? t('照片大图预览') : t('素材大图预览')}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        if (navigation && event.key === 'ArrowLeft') {
          event.preventDefault();
          navigation.onPrevious();
        }
        if (navigation && event.key === 'ArrowRight') {
          event.preventDefault();
          navigation.onNext();
        }
      }}
    >
      <header>
        <div>
          <strong>{asset.displayName}</strong>
          <span>
            {asset.width && asset.height
              ? `${asset.width} × ${asset.height}`
              : asset.format.toUpperCase()}
          </span>
        </div>
        <button type="button" aria-label={t('关闭大图预览')} onClick={onClose}>
          <IconX size={22} />
        </button>
      </header>
      <div
        className={styles.stage}
        onClick={navigation ? undefined : onClose}
        onTouchStart={(event) => {
          const point = event.touches[0];
          touchStart.current = point ? { x: point.clientX, y: point.clientY } : null;
        }}
        onTouchEnd={(event) => {
          const point = event.changedTouches[0],
            start = touchStart.current;
          touchStart.current = null;
          if (!point || !start || !navigation) return;
          const dx = point.clientX - start.x,
            dy = point.clientY - start.y;
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
            (dx < 0 ? navigation.onNext : navigation.onPrevious)();
        }}
      >
        {navigation && (
          <button
            type="button"
            className={styles.previous}
            aria-label={t('上一张')}
            onClick={navigation.onPrevious}
          >
            ‹
          </button>
        )}
        {navigation && (
          <button
            type="button"
            className={styles.next}
            aria-label={t('下一张')}
            onClick={navigation.onNext}
          >
            ›
          </button>
        )}
        {loading ? (
          <p role="status">{t('正在加载…')}</p>
        ) : isCameraVideoMime(asset.mimeType) ? (
          videoUrl ? (
            <video
              className={styles.videoPlayer}
              src={videoUrl}
              aria-label={t('播放 {{value1}}', {
                value1: asset.displayName,
              })}
              controls
              autoPlay
              playsInline
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <p>{t('预览图尚未生成')}</p>
          )
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={asset.displayName}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <p>{t('预览图尚未生成')}</p>
        )}
      </div>
      <footer className={navigation ? styles.navigation : undefined}>
        {navigation ? (
          <>
            <span>
              {navigation.index + 1} / {navigation.count}
            </span>
            {actions}
          </>
        ) : (
          t('Esc 关闭 · 双击素材或按 Enter 进入详情 · Space 快速预览')
        )}
      </footer>
    </div>
  );
}
