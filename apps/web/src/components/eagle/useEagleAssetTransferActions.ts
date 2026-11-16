import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { t } from '../../i18n';
import { copyImageToClipboard } from '../../lib/image-clipboard';
import type { LibraryMode } from '../../lib/library-api-scope';
import { downloadOriginalFiles, saveOriginalFile } from '../../lib/original-file-export';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import type { EagleSelectionGesture } from './eagle-selection';
import {
  getAssetDragIds,
  getDesktopAssetDragBridge,
  isFileDrag,
} from './eagle-asset-drag';
import {
  DesktopAssetDragSession,
  type DesktopAssetDragStatus,
} from './eagle-asset-drag-session';
import { getEaglePreviewContentUrl } from './eagle-media-sources';
import type { getEagleWorkspaceCache, EagleLibraryView } from './eagle-workspace-cache';

interface TransferContextMenu {
  x: number;
  y: number;
}

export function useEagleAssetTransferActions(options: {
  libraryMode: LibraryMode;
  libraryView: EagleLibraryView;
  ownerId: string;
  accessToken: string;
  assets: EagleAssetListItem[];
  selectedAssetIds: string[];
  contextMenuAsset: EagleAssetListItem | null | undefined;
  workspaceCache: ReturnType<typeof getEagleWorkspaceCache>;
  getEagleAsset: (token: string, id: string) => Promise<EagleAssetListItem>;
  selectAsset: (assetId: string, gesture: EagleSelectionGesture) => void;
  setAssetContextMenu: (position: TransferContextMenu | null) => void;
  importFiles: (files: File[]) => void | Promise<void>;
}) {
  const {
    libraryMode,
    libraryView,
    ownerId,
    accessToken,
    assets,
    selectedAssetIds,
    contextMenuAsset,
    workspaceCache,
    getEagleAsset,
    selectAsset,
    setAssetContextMenu,
    importFiles,
  } = options;

  const dragDepthRef = useRef(0);
  const importDragActiveRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [originalFileError, setOriginalFileError] = useState<{
    message: string;
    id: number;
  } | null>(null);
  const [assetDragStatus, setAssetDragStatus] = useState<DesktopAssetDragStatus>(null);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [assetActionPending, setAssetActionPending] = useState<'copy' | 'save' | null>(null);
  const [assetActionError, setAssetActionError] = useState<string | null>(null);

  useEffect(() => {
    setOriginalFileError(null);
    setAssetDragStatus(null);
  }, [ownerId, libraryMode]);

  useEffect(() => {
    if (!originalFileError) return undefined;
    const timer = window.setTimeout(() => setOriginalFileError(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [originalFileError]);

  const desktopAssetDragBridge = useMemo(
    () => getDesktopAssetDragBridge(libraryMode),
    [libraryMode],
  );
  const assetDragSession = useMemo(
    () =>
      desktopAssetDragBridge
        ? new DesktopAssetDragSession(
            desktopAssetDragBridge,
            (error) => {
              setAssetDragStatus(null);
              const message = error instanceof Error ? error.message : t('原文件拖出失败。');
              setOriginalFileError((current) => ({
                message,
                id: (current?.id ?? 0) + 1,
              }));
            },
            setAssetDragStatus,
          )
        : null,
    [desktopAssetDragBridge, ownerId],
  );

  useEffect(
    () => () => {
      assetDragSession?.reset();
    },
    [assetDragSession],
  );

  useEffect(() => {
    if (!assetDragSession) return undefined;
    const endPendingGesture = () => {
      if (!assetDragSession.hasNativeDragStarted()) assetDragSession.end('cancelled');
    };
    window.addEventListener('pointerup', endPendingGesture, true);
    window.addEventListener('pointercancel', endPendingGesture, true);
    return () => {
      window.removeEventListener('pointerup', endPendingGesture, true);
      window.removeEventListener('pointercancel', endPendingGesture, true);
    };
  }, [assetDragSession]);

  const getDragAssetIds = (assetId: string) =>
    getAssetDragIds({
      orderedIds: assets.map((asset) => asset.id),
      selectedIds: selectedAssetIds,
      draggedId: assetId,
    });

  const queueOriginalDownloads = async (selected: EagleAssetListItem[]) => {
    const epoch = workspaceCache.downloads.epoch;
    const originals = new Map(selected.map((asset) => [asset.id, asset]));
    for (const asset of selected) {
      const id = asset.livePhotoMotion?.assetId;
      if (id && !originals.has(id)) originals.set(id, await getEagleAsset(accessToken, id));
    }
    if (epoch !== workspaceCache.downloads.epoch)
      throw new DOMException('Scope revoked', 'AbortError');
    return downloadOriginalFiles([...originals.values()], {
      queueBrowserDownloads: (items) => workspaceCache.downloads.enqueue(items),
    });
  };

  const saveSelectedOriginal = () => {
    if (!contextMenuAsset || assetActionPending) return;
    setAssetActionPending('save');
    setAssetActionError(null);
    const download = contextMenuAsset.livePhotoMotion
      ? queueOriginalDownloads([contextMenuAsset])
      : saveOriginalFile(contextMenuAsset);
    void download.then(
      () => {
        setAssetActionPending(null);
        setAssetContextMenu(null);
      },
      () => {
        setAssetActionPending(null);
        setAssetActionError(
          t('另存原文件失败{{value1}}', {
            value1: t('，请重试。'),
          }),
        );
      },
    );
  };

  const copySelectedImage = () => {
    const previewUrl = contextMenuAsset ? getEaglePreviewContentUrl(contextMenuAsset) : null;
    if (!contextMenuAsset?.mimeType.startsWith('image/') || !previewUrl || assetActionPending) {
      return;
    }
    setAssetActionPending('copy');
    setAssetActionError(null);
    void copyImageToClipboard(previewUrl).then(
      () => {
        setAssetActionPending(null);
        setAssetContextMenu(null);
      },
      (error: unknown) => {
        setAssetActionPending(null);
        const detail = error instanceof Error ? `：${error.message}` : t('，请重试。');
        setAssetActionError(
          t('复制图片失败{{value1}}', {
            value1: detail,
          }),
        );
      },
    );
  };

  const handleAssetDragStart = (event: DragEvent<HTMLButtonElement>, assetId: string) => {
    event.preventDefault();
    if (!assetDragSession || libraryView === 'TRASH') return;
    const assetIds = getDragAssetIds(assetId);
    if (!selectedAssetIds.includes(assetId)) selectAsset(assetId, 'single');
    setAssetContextMenu(null);
    setOriginalFileError(null);
    assetDragSession.begin(assetIds);
  };

  const batchDownloadSelectedOriginals = () => {
    if (isBatchDownloading) return;
    const selected = new Set(selectedAssetIds);
    const selectedAssets = assets.filter((asset) => selected.has(asset.id));
    if (selectedAssets.length < 2) return;
    setIsBatchDownloading(true);
    setOriginalFileError(null);
    void queueOriginalDownloads(selectedAssets).then(
      () => {
        setAssetContextMenu(null);
        setIsBatchDownloading(false);
      },
      () => {
        setAssetContextMenu(null);
        setIsBatchDownloading(false);
        setOriginalFileError((current) => ({
          message: t('批量下载原文件失败。'),
          id: (current?.id ?? 0) + 1,
        }));
      },
    );
  };

  const handleAssetDragEnd = () => {
    assetDragSession?.end();
    dragDepthRef.current = 0;
    setIsDragging(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    if (assetDragSession?.isOutboundDrag()) return;
    if (!isFileDrag(event)) return;
    event.preventDefault();
    importDragActiveRef.current = true;
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!importDragActiveRef.current) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      importDragActiveRef.current = false;
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (libraryView === 'PROCESSING' || libraryView === 'ACCOUNT') return;
    if (assetDragSession?.isOutboundDrag()) {
      event.preventDefault();
      assetDragSession.end();
      importDragActiveRef.current = false;
      dragDepthRef.current = 0;
      setIsDragging(false);
      return;
    }
    if (!isFileDrag(event) && event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    importDragActiveRef.current = false;
    dragDepthRef.current = 0;
    setIsDragging(false);
    void importFiles([...event.dataTransfer.files]);
  };

  return {
    desktopAssetDragBridge,
    assetDragSession,
    isDragging,
    originalFileError,
    setOriginalFileError,
    assetDragStatus,
    isBatchDownloading,
    assetActionPending,
    assetActionError,
    setAssetActionError,
    saveSelectedOriginal,
    copySelectedImage,
    handleAssetDragStart,
    batchDownloadSelectedOriginals,
    handleAssetDragEnd,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  };
}
