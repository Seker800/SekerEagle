import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { IconEdit } from '@tabler/icons-react';
import { isCameraRawMime } from '@sekereagle/library-core';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { getEagleEditContentUrl } from './eagle-media-sources';
import { createEagleQueryKeys } from './eagle-query-keys';
import { formatPhotoMetadata } from '../media/photo-editor/photo-editor-metadata';
import type { PhotoMetadata } from '../media/photo-editor/photo-watermark-model';
import type { SavedPhoto } from '../media/photo-editor/photo-editor-save';
import styles from './EaglePhotoEditing.module.css';

const PhotoEditor = lazy(() =>
  import('../media/photo-editor/PhotoEditor').then(({ PhotoEditor }) => ({ default: PhotoEditor })),
);

export function eaglePhotoEditLabel(asset: EagleAssetListItem) {
  return isCameraRawMime(asset.mimeType) ? t('编辑 RAW 显影副本') : t('编辑照片');
}

export function EagleEditPhotoButton({
  asset,
  onEdit,
  role,
}: {
  asset: EagleAssetListItem;
  onEdit?: (asset: EagleAssetListItem) => void;
  role?: 'menuitem';
}) {
  if (!onEdit || !getEagleEditContentUrl(asset)) return null;
  return (
    <button type="button" role={role} onClick={() => onEdit(asset)}>
      <IconEdit size={16} />
      {eaglePhotoEditLabel(asset)}
    </button>
  );
}

/** Use capture wall time, independent of the browser's timezone. No GPS enters the editor. */
export function eaglePhotoWatermarkMetadata(asset: EagleAssetListItem): PhotoMetadata {
  const data = asset.photoMetadata;
  if (!data) return {};
  const formatted = formatPhotoMetadata({
    Make: data.cameraMake,
    Model: data.cameraModel,
    FocalLength: data.focalLength,
    FNumber: data.aperture,
    ExposureTime: data.exposureSeconds,
    ISO: data.iso,
  });
  const wall = data.capturedLocal?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return {
    ...formatted,
    capturedAt: wall ? `${wall[1]}.${wall[2]}.${wall[3]} ${wall[4]}:${wall[5]}` : undefined,
  };
}

interface PhotoEditSession {
  scopeKey: string;
  source: string;
  name: string;
  initialMetadata: PhotoMetadata;
  onSave: (file: File) => Promise<SavedPhoto>;
}

export function useEaglePhotoEditing({
  accessToken,
  ownerId,
  scopeKey,
}: {
  accessToken: string;
  ownerId: string;
  scopeKey: string;
}) {
  const { libraryMode, api } = useLibraryWorkspace();
  const client = useQueryClient();
  const [session, setSession] = useState<PhotoEditSession | null>(null);
  useEffect(() => {
    setSession(null);
  }, [scopeKey]);
  const close = () => setSession(null);
  const open = (asset: EagleAssetListItem) => {
    const source = getEagleEditContentUrl(asset);
    if (!source || (asset.libraryMode && asset.libraryMode !== libraryMode)) return;
    const sourceId = asset.id,
      sourceVersion = asset.rowVersion;
    const upload = api.uploadEagleAsset;
    const queryKey = createEagleQueryKeys(ownerId, libraryMode).assets;
    setSession({
      scopeKey,
      source,
      name: asset.displayName,
      initialMetadata: eaglePhotoWatermarkMetadata(asset),
      onSave: async (file) => {
        const result = await upload(accessToken, file, () => undefined, {
          duplicatePolicy: 'CREATE_COPY',
          copySourceAssetId: sourceId,
          copySourceRowVersion: sourceVersion,
          retry: true,
        });
        // A refresh error must not turn a completed upload into a duplicate save.
        void client.invalidateQueries({ queryKey }).catch(() => undefined);
        return { id: result.asset.id, name: file.name };
      },
    });
  };
  return { session: session?.scopeKey === scopeKey ? session : null, open, close };
}

export function EaglePhotoEditorDialog({
  session,
  onClose,
  onOpenSaved,
}: {
  session: PhotoEditSession | null;
  onClose: () => void;
  onOpenSaved: (assetId: string) => Promise<void>;
}) {
  if (!session) return null;
  return createPortal(
    <Suspense
      fallback={
        <div className={styles.loading} role="dialog" aria-label={t('编辑照片')}>
          <p role="status">{t('正在读取照片…')}</p>
          <button onClick={onClose}>{t('关闭')}</button>
        </div>
      }
    >
      <PhotoEditor
        key={session.source}
        {...session}
        onClose={onClose}
        onOpenSaved={async (id) => {
          await onOpenSaved(id);
          onClose();
        }}
      />
    </Suspense>,
    document.body,
  );
}
