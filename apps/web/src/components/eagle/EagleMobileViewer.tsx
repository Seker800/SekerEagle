import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  IconShare2,
  IconEdit,
  IconHeart,
  IconHeartFilled,
  IconTrash,
  IconDotsCircleHorizontal,
  IconDownload,
} from '@tabler/icons-react';
import { getLocale, t, tForLocale } from '../../i18n';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { saveOriginalFile } from '../../lib/original-file-export';
import type { EagleMobileViewerPresentation } from './EagleViewerShell';
import styles from './EagleMobileViewer.module.css';
type ViewerApi = Pick<
  ReturnType<typeof useLibraryWorkspace>['api'],
  | 'listEagleManualTags'
  | 'createEagleManualTag'
  | 'batchChangeEagleManualTags'
  | 'getEaglePrivacySettings'
>;
// A persisted tag name must stay stable when the UI language changes.
const FAVORITE_TAG = tForLocale('zh-CN', '收藏');
/** Favorites reuse a visible manual tag; never silently attach a privacy rule. */
export async function toggleViewerFavorite(
  api: ViewerApi,
  asset: EagleAssetListItem,
  favorite: boolean,
) {
  const tags = await api.listEagleManualTags('');
  let tag = tags.find((item) => item.name === FAVORITE_TAG);
  if (!favorite && !tag) tag = await api.createEagleManualTag('', { name: FAVORITE_TAG });
  if (!tag) return;
  const privacy = await api.getEaglePrivacySettings();
  if (privacy.tagIds.includes(tag.id)) throw new Error(t('收藏标签被设为私密，请先在设置中调整。'));
  await api.batchChangeEagleManualTags('', {
    assetIds: [asset.id],
    addTagIds: favorite ? [] : [tag.id],
    removeTagIds: favorite ? [tag.id] : [],
  });
}
export function mobileViewerPresentation(
  asset: EagleAssetListItem,
  onClose: () => void,
  onEdit: (() => void) | undefined,
  more: ReactNode,
  onRotate?: () => void,
  readOnly = false,
): EagleMobileViewerPresentation {
  const value =
    asset.photoMetadata?.capturedLocal ??
    asset.photoMetadata?.capturedAt ??
    asset.chronologicalAt ??
    asset.libraryAddedAt;
  const date = new Date(value);
  const valid = Number.isFinite(date.getTime());
  return {
    date: valid
      ? new Intl.DateTimeFormat(getLocale(), {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date)
      : asset.displayName,
    time: valid
      ? new Intl.DateTimeFormat(getLocale(), {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date)
      : undefined,
    onRotate,
    actions: (
      <MobileViewerActions
        key={`${asset.libraryMode}:${asset.id}`}
        asset={asset}
        onClose={onClose}
        onEdit={onEdit}
        readOnly={readOnly}
        more={more}
      />
    ),
  };
}
function MobileViewerActions({
  asset,
  onClose,
  onEdit,
  more,
  readOnly,
}: {
  asset: EagleAssetListItem;
  onClose: () => void;
  onEdit?: () => void;
  more: ReactNode;
  readOnly: boolean;
}) {
  const { api, ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const [favorite, setFavorite] = useState(
    () => asset.manualTags?.some((tag) => tag.name === FAVORITE_TAG) ?? false,
  );
  useEffect(
    () => setFavorite(asset.manualTags?.some((tag) => tag.name === FAVORITE_TAG) ?? false),
    [asset.manualTags],
  );
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [downloadFallback, setDownloadFallback] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : t('操作失败'));
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const invalidate = () => client.invalidateQueries({ queryKey: ['eagle', ownerId, libraryMode] });
  const download = () =>
    run(async () => {
      await saveOriginalFile({ ...asset, libraryMode });
    });
  const share = () =>
    run(async () => {
      if (!navigator.share || asset.byteSize > 32 * 1024 * 1024) {
        setDownloadFallback(true);
        return;
      }
      const response = await fetch(api.getEagleAssetContentUrl(asset.id), {
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(t('无法读取原文件，请重试。'));
      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('无法读取原文件，请重试。'));
      const chunks: BlobPart[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 32 * 1024 * 1024) {
            await reader.cancel();
            setDownloadFallback(true);
            return;
          }
          chunks.push(new Uint8Array(part.value));
        }
      } finally {
        reader.releaseLock();
      }
      const file = new File(chunks, asset.originalName, { type: asset.mimeType });
      if (!navigator.canShare?.({ files: [file] })) {
        setDownloadFallback(true);
        return;
      }
      try {
        await navigator.share({ files: [file], title: asset.displayName });
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) throw reason;
      }
    });
  return (
    <div className={styles.root}>
      <div className={styles.bar} role="toolbar" aria-label={t('图片操作')}>
        <button type="button" disabled={pending} onClick={() => void share()}>
          <IconShare2 />
          <span>{t('发送')}</span>
        </button>
        <button type="button" disabled={!onEdit || pending || readOnly} onClick={onEdit}>
          <IconEdit />
          <span>{t('编辑')}</span>
        </button>
        <button
          type="button"
          aria-pressed={favorite}
          title={t('使用收藏标签')}
          disabled={pending || readOnly}
          onClick={() =>
            void run(async () => {
              await toggleViewerFavorite(api, asset, favorite);
              if (alive.current) setFavorite(!favorite);
              await invalidate();
            })
          }
        >
          {favorite ? <IconHeartFilled /> : <IconHeart />}
          <span>{favorite ? t('已收藏') : t('收藏')}</span>
        </button>
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => {
            if (window.confirm(t('移入当前图库回收站？可以在回收站恢复。')))
              void run(async () => {
                await api.batchTrashEagleAssets('', [asset.id]);
                await invalidate();
                onClose();
              });
          }}
        >
          <IconTrash />
          <span>{t('删除')}</span>
        </button>
        <details className={styles.more}>
          <summary>
            <IconDotsCircleHorizontal />
            <span>{t('更多')}</span>
          </summary>
          <div className={styles.menu}>
            <strong>{asset.displayName}</strong>
            <p>
              {asset.format?.toUpperCase()} · {asset.width} × {asset.height}
            </p>
            <button type="button" onClick={() => void download()}>
              <IconDownload size={18} />
              {t('下载原文件')}
            </button>
            {more}
          </div>
        </details>
      </div>
      {downloadFallback && (
        <div className={styles.notice} role="status">
          <span>{t('当前环境不支持系统分享，可先下载原文件。')}</span>
          <button type="button" onClick={() => void download()}>
            {t('下载原文件')}
          </button>
          <button type="button" onClick={() => setDownloadFallback(false)}>
            {t('关闭')}
          </button>
        </div>
      )}
      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
