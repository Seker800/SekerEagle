import { type PhotoEditRecipe, type PhotoEdits } from '@sekereagle/library-core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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

export interface PhotoEditSession {
  scopeKey: string;
  source: string;
  name: string;
  initialMetadata: PhotoMetadata;
  initialEdits?: PhotoEdits;
  load?: () => Promise<PhotoEditSession>;
  onDraftChange?: (recipe: PhotoEditRecipe) => Promise<unknown>;
  onCopyEdits?: (recipe: PhotoEditRecipe) => void;
  onSave: (file: File, recipe?: PhotoEditRecipe) => Promise<SavedPhoto>;
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
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const [clipboard, setClipboard] = useState<{ scopeKey: string; recipe: PhotoEditRecipe } | null>(
    null,
  );
  const [session, setSession] = useState<PhotoEditSession | null>(null);
  useEffect(() => {
    setSession(null);
    setClipboard(null);
  }, [scopeKey]);
  const close = () => setSession(null);
  const assertScope = () => {
    if (currentScope.current !== scopeKey) throw new Error(t('编辑会话已失效，请重新打开。'));
  };
  const createSession = (
    asset: EagleAssetListItem,
    initialEdits?: PhotoEdits,
  ): PhotoEditSession | null => {
    const source = getEagleEditContentUrl(asset);
    if (!source || (asset.libraryMode && asset.libraryMode !== libraryMode)) return null;
    const sourceId = asset.id,
      sourceVersion = asset.rowVersion;
    const upload = api.uploadEagleAsset;
    const keys = createEagleQueryKeys(ownerId, libraryMode);
    return {
      scopeKey,
      source,
      name: asset.displayName,
      initialMetadata: eaglePhotoWatermarkMetadata(asset),
      initialEdits,
      onDraftChange: async (recipe) => {
        assertScope();
        return api.saveEagleEditRecipe(sourceId, asset.mediaRevision, recipe);
      },
      onCopyEdits: (recipe) => {
        assertScope();
        setClipboard({ scopeKey, recipe });
      },
      onSave: async (file, recipe) => {
        assertScope();
        const result = await upload(accessToken, file, () => undefined, {
          duplicatePolicy: 'CREATE_COPY',
          copySourceAssetId: sourceId,
          copySourceRowVersion: sourceVersion,
          retry: true,
          ...(recipe ? { editRecipe: recipe } : {}),
        });
        // A refresh error must not turn a completed upload into a duplicate save.
        for (const queryKey of [keys.assets, keys.manualTags]) {
          void client.invalidateQueries({ queryKey }).catch(() => undefined);
        }
        return { id: result.asset.id, name: file.name };
      },
    };
  };
  const resolveSession = async (asset: EagleAssetListItem) => {
    assertScope();
    const stored = await api.getEagleEditRecipe(asset.id);
    const base = stored?.baseAssetId
      ? await api.getEagleAsset(accessToken, stored.baseAssetId)
      : asset;
    assertScope();
    if (stored && base.mediaRevision !== stored.baseMediaRevision)
      throw new Error(t('原照片内容已变化，无法恢复编辑参数。'));
    const resolved = createSession(base, stored?.recipe.edits);
    if (!resolved) throw new Error(t('此照片暂不支持编辑。'));
    return resolved;
  };
  const open = (asset: EagleAssetListItem) => {
    const next = createSession(asset);
    if (next) setSession({ ...next, load: () => resolveSession(asset) });
  };
  return {
    session: session?.scopeKey === scopeKey ? session : null,
    open,
    close,
    resolveSession,
    clipboard: clipboard?.scopeKey === scopeKey ? clipboard.recipe : null,
  };
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
      <ResolvedPhotoEditor
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

function ResolvedPhotoEditor(
  props: PhotoEditSession & { onClose: () => void; onOpenSaved: (id: string) => Promise<void> },
) {
  const [resolved, setResolved] = useState<PhotoEditSession | null>(props.load ? null : props);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (!props.load) return;
    setError('');
    void props.load().then(
      (value) => {
        if (!cancelled) setResolved(value);
      },
      (reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('操作失败'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [props.load, attempt]);
  if (!resolved)
    return (
      <div className={styles.loading} role="dialog" aria-label={t('编辑照片')}>
        <p role={error ? 'alert' : 'status'}>{error || t('正在读取照片…')}</p>
        {error && <button onClick={() => setAttempt((value) => value + 1)}>{t('重试')}</button>}
        <button onClick={props.onClose}>{t('关闭')}</button>
      </div>
    );
  return <PhotoEditor {...resolved} onClose={props.onClose} onOpenSaved={props.onOpenSaved} />;
}
