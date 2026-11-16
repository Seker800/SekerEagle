import { memo, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { IconCheck, IconLock } from '@tabler/icons-react';
import { t } from '../../i18n';
import type { EagleAssetListItem, EaglePhotoStack } from '../../lib/eagle-api';
import type { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import type { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import { getEagleLivePhotoContentUrl } from './eagle-media-sources';
import { mediaProcessingFailure } from '../../lib/media-processing-error';
import { EagleAssetThumbnail } from './EagleAssetThumbnail';
import { EagleStackBadge } from './EagleStackBadge';
import styles from './SekerEaglePage.module.css';

export interface AssetCardLayout {
  height: number;
  left: number;
  top: number;
  width: number;
  previewHeight: number;
}

export interface AssetCardActions {
  click: (event: MouseEvent<HTMLButtonElement>, assetId: string) => void;
  contextMenu: (event: MouseEvent<HTMLButtonElement>, assetId: string) => void;
  dragStart: (event: DragEvent<HTMLButtonElement>, assetId: string) => void;
  dragEnd: () => void;
  doubleClick: (asset: EagleAssetListItem) => void;
  keyDown: (event: KeyboardEvent<HTMLButtonElement>, asset: EagleAssetListItem) => void;
  processingActions: (asset: EagleAssetListItem) => void;
}

interface EagleAssetCardProps {
  asset: EagleAssetListItem;
  stack?: EaglePhotoStack;
  selected: boolean;
  disabled: boolean;
  selectionMode: boolean;
  batchSelection: boolean;
  dragEnabled: boolean;
  libraryMode: 'MATERIAL' | 'PHOTO';
  layout?: AssetCardLayout;
  scheduler: MediaLoadScheduler;
  loadService?: ThumbnailLoadService;
  actions: AssetCardActions;
}

function EagleAssetCardView({
  asset,
  stack,
  selected,
  disabled,
  selectionMode,
  batchSelection,
  dragEnabled,
  libraryMode,
  layout,
  scheduler,
  loadService,
  actions,
}: EagleAssetCardProps) {
  const failure =
    asset.lifecycleStatus === 'FAILED' ? mediaProcessingFailure(asset.mediaErrorCode) : null;
  return (
    <button
      disabled={disabled}
      data-asset-id={asset.id}
      type="button"
      className={`${styles.assetCard} ${selected ? styles.assetCardSelected : ''}`}
      aria-pressed={selected}
      aria-label={`${asset.displayName}，${asset.format.toUpperCase()}${stack ? `，${t('照片组，共 {{value1}} 张', { value1: stack.assetIds.length })}` : ''}`}
      draggable={dragEnabled}
      style={
        layout
          ? {
              height: layout.height,
              transform: `translate3d(${layout.left}px, ${layout.top}px, 0)`,
              width: layout.width,
            }
          : undefined
      }
      onClick={(event) => {
        event.stopPropagation();
        actions.click(event, asset.id);
      }}
      onContextMenu={(event) => actions.contextMenu(event, asset.id)}
      onDragStart={(event) => actions.dragStart(event, asset.id)}
      onDragEnd={actions.dragEnd}
      onDoubleClick={() => actions.doubleClick(asset)}
      onKeyDown={(event) => actions.keyDown(event, asset)}
    >
      <span className={styles.preview} style={{ height: layout?.previewHeight }}>
        {getEagleLivePhotoContentUrl(asset) && (
          <span className={styles.livePhotoBadge}>{t('实况')}</span>
        )}
        <EagleStackBadge count={stack?.assetIds.length ?? 0} />
        {(selectionMode || batchSelection) && (
          <span className={styles.selectionMark}>{selected && <IconCheck size={13} />}</span>
        )}
        <EagleAssetThumbnail
          asset={asset}
          scheduler={scheduler}
          loadService={loadService}
          order={layout ? -layout.top : 0}
          displayWidth={Math.ceil(layout?.width ?? 0)}
        />
        {asset.lifecycleStatus !== 'READY' && (
          <span
            className={styles.processing}
            data-failed={asset.lifecycleStatus === 'FAILED' ? 'true' : undefined}
            role={asset.lifecycleStatus === 'FAILED' ? 'button' : undefined}
            tabIndex={asset.lifecycleStatus === 'FAILED' ? 0 : undefined}
            title={failure?.detail}
            onClick={(event) => {
              if (!failure) return;
              event.stopPropagation();
              actions.processingActions(asset);
            }}
            onKeyDown={(event) => {
              if (!failure || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              event.stopPropagation();
              actions.processingActions(asset);
            }}
          >
            {failure ? failure.label : t('处理中')}
          </span>
        )}
        {asset.isPrivate && (
          <span
            className={styles.privateMark}
            title={libraryMode === 'PHOTO' ? t('隐私照片') : t('隐私素材')}
          >
            <IconLock size={12} />
          </span>
        )}
      </span>
    </button>
  );
}

export const EagleAssetCard = memo(EagleAssetCardView);
