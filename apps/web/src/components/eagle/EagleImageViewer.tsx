import { EagleFavoriteButton } from './EagleFavoriteButton';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { mobileViewerPresentation } from './EagleMobileViewer';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import { EagleViewerShell, type EagleViewerNavigation } from './EagleViewerShell';
import { t } from '../../i18n';
import { IconAdjustments, IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import type { PreviewImage } from '../media/image-preview/useImagePreviewState';
import { createEaglePreviewTileSource, createEagleTileSource } from './eagle-media-sources';
import { EagleLivePhotoPlayback } from './EagleLivePhotoPlayback';
import { EagleLocateAssetButton } from './EagleLocateAssetButton';
import { EagleImageCopyButton } from './EagleImageCopyButton';
import styles from './EagleImageViewer.module.css';
type ViewerStatus = 'loading' | 'ready' | 'error';
type ViewerSource = ReturnType<typeof createEaglePreviewTileSource | typeof createEagleTileSource>;
type ViewerPoint = {
  x: number;
  y: number;
};
interface ViewerRect {
  containsPoint(point: ViewerPoint): boolean;
  height: number;
  width: number;
  x: number;
  y: number;
}
interface ViewerDragEvent {
  delta: {
    negate(): ViewerPoint;
  };
  pointerType: string;
  preventDefaultAction: boolean;
}
interface ViewerDragEndEvent {
  pointerType: string;
  preventDefaultAction: boolean;
}
interface ViewerScrollEvent {
  pointerType: string;
  position: ViewerPoint;
  preventDefaultAction: boolean;
  scroll: number;
}
interface ViewerClickEvent {
  position: ViewerPoint;
  quick: boolean;
}
interface ViewerViewport {
  goHome(immediately?: boolean): void;
  applyConstraints(immediately?: boolean): void;
  deltaPointsFromPixels(point: ViewerPoint): ViewerPoint;
  getCenter(current?: boolean): ViewerPoint;
  getZoom(current?: boolean): number;
  getHomeZoom?(): number;
  setRotation?(degrees: number, immediately?: boolean): void;
  panBy(point: ViewerPoint, immediately?: boolean): void;
  panTo(point: ViewerPoint, immediately?: boolean): void;
  pointFromPixel(point: ViewerPoint, current?: boolean): ViewerPoint;
  zoomBy(factor: number, refPoint?: ViewerPoint, immediately?: boolean): void;
  zoomTo(zoom: number, refPoint?: ViewerPoint, immediately?: boolean): void;
}
interface ViewerWorldItem {
  getBounds(): ViewerRect;
  getFullyLoaded?(): boolean;
}
interface ViewerHandle {
  addHandler(name: 'open' | 'open-failed' | 'after-resize' | 'zoom', handler: () => void): void;
  addHandler(
    name: 'fully-loaded-change' | 'tile-loaded' | 'tile-load-failed',
    handler: (event?: unknown) => void,
  ): void;
  addHandler(name: 'canvas-click', handler: (event: ViewerClickEvent) => void): void;
  addHandler(name: 'canvas-drag', handler: (event: ViewerDragEvent) => void): void;
  addHandler(name: 'canvas-drag-end', handler: (event: ViewerDragEndEvent) => void): void;
  addHandler(name: 'canvas-scroll', handler: (event: ViewerScrollEvent) => void): void;
  addOverlay(options: {
    checkResize: boolean;
    element: HTMLImageElement;
    location: ViewerRect;
  }): void;
  addTiledImage(options: {
    error?: (event?: unknown) => void;
    success?: (event: { item: ViewerWorldItem }) => void;
    tileSource: ViewerSource;
    width?: number;
    x?: number;
    y?: number;
  }): void;
  destroy(): void;
  forceRedraw(): void;
  open(source: ViewerSource): void;
  viewport: ViewerViewport;
  world: {
    getItemAt(index: number): ViewerWorldItem | undefined;
    removeItem(item: ViewerWorldItem): void;
  };
  zoomPerScroll: number;
}
const DIRECT_INTERACTION_ANIMATION_SECONDS = 0.08;
const PYRAMID_UPGRADE_IDLE_MS = 120;
const MAX_ZOOM_PIXEL_RATIO = 8;
function isDirectPointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}
function computeTileTotal(descriptor: EaglePyramidDescriptor, level: number) {
  const scale = Math.pow(2, level - descriptor.maxLevel);
  const width = Math.max(1, Math.ceil(descriptor.width * scale));
  const height = Math.max(1, Math.ceil(descriptor.height * scale));
  const tileSize = Math.max(1, descriptor.tileSize);
  return Math.max(1, Math.ceil(width / tileSize) * Math.ceil(height / tileSize));
}
async function importOpenSeadragon() {
  return import('openseadragon');
}
let openSeadragonModulePromise: ReturnType<typeof importOpenSeadragon> | undefined;
function loadOpenSeadragon() {
  if (!openSeadragonModulePromise) {
    openSeadragonModulePromise = importOpenSeadragon().catch((error: unknown) => {
      openSeadragonModulePromise = undefined;
      throw error;
    });
  }
  return openSeadragonModulePromise;
}
export function preloadEagleImageViewer(): void {
  void loadOpenSeadragon().catch(() => undefined);
}
export function EagleImageViewer({
  image,
  asset,
  readOnly = false,
  descriptor,
  onLocate,
  onClose,
  onEdit,
  editLabel,
  navigation,
  subtitle,
  collection,
  actions,
  loading = false,
  loadingPlaceholder,
  previewLimited = false,
  highResolutionSrc,
  error,
  onRetry,
}: {
  image: PreviewImage;
  asset?: EagleAssetListItem;
  readOnly?: boolean;
  descriptor?: EaglePyramidDescriptor;
  previewLimited?: boolean;
  highResolutionSrc?: string | null;
  onLocate?: (assetId: string) => Promise<void>;
  onClose: () => void;
  onEdit?: () => void;
  editLabel?: string;
  navigation?: EagleViewerNavigation;
  subtitle?: string;
  collection?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  loadingPlaceholder?: ReactNode;
  error?: string;
  onRetry?: () => void;
}) {
  const compact = useCompactLayout();
  const [zoomActivated, setZoomActivated] = useState(false);
  const [loadedOriginalSrc, setLoadedOriginalSrc] = useState<string | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [originalPercent, setOriginalPercent] = useState<number | null>(null);
  const originalUrlRef = useRef<string | null>(null);
  const rotation = useRef(0);
  useEffect(() => {
    rotation.current = 0;
    setZoomActivated(false);
    setLoadedOriginalSrc(null);
    setOriginalLoading(false);
    setOriginalPercent(null);
    return () => {
      if (originalUrlRef.current) {
        URL.revokeObjectURL(originalUrlRef.current);
        originalUrlRef.current = null;
      }
    };
  }, [image.assetId, image.src]);
  useEffect(() => {
    if (!zoomActivated || descriptor || !highResolutionSrc || loadedOriginalSrc) return;
    const controller = new AbortController();
    let cancelled = false;
    setOriginalLoading(true);
    setOriginalPercent(null);
    void (async () => {
      try {
        const response = await fetch(highResolutionSrc, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('HIGH_RES_LOAD_FAILED');
        const total = Number(response.headers.get('content-length') ?? 0);
        const contentType = response.headers.get('content-type') ?? 'image/jpeg';
        const reader = response.body?.getReader();
        let blob: Blob;
        if (reader) {
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            if (total) setOriginalPercent(Math.min(99, Math.round((received / total) * 100)));
          }
          blob = new Blob(chunks as BlobPart[], { type: contentType });
        } else {
          blob = await response.blob();
        }
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        originalUrlRef.current = url;
        setOriginalPercent(100);
        setLoadedOriginalSrc(url);
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setOriginalLoading(false);
          setOriginalPercent(null);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [zoomActivated, descriptor, highResolutionSrc, loadedOriginalSrc]);
  const previewSource = useMemo(() => createEaglePreviewTileSource(image.src), [image.src]);
  const previewKey = `preview:${image.src}`;
  const highResolutionSource = useMemo(() => {
    if (!zoomActivated) return null;
    if (descriptor) return createEagleTileSource(descriptor);
    return loadedOriginalSrc ? createEaglePreviewTileSource(loadedOriginalSrc) : null;
  }, [zoomActivated, descriptor, loadedOriginalSrc]);
  const highResolutionKey = !highResolutionSource
    ? null
    : descriptor
      ? `pyramid:${descriptor.id}`
      : `original:${loadedOriginalSrc}`;
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | undefined>(undefined);
  const viewerAliveRef = useRef(false);
  const imageRef = useRef(image);
  const onCloseRef = useRef(onClose);
  const previewSourceRef = useRef<ViewerSource>(previewSource);
  const previewKeyRef = useRef(previewKey);
  const requestedPreviewKeyRef = useRef('');
  const openedPreviewKeyRef = useRef('');
  const previewItemRef = useRef<ViewerWorldItem | null>(null);
  const detailItemRef = useRef<ViewerWorldItem | null>(null);
  const detailKeyRef = useRef<string | null>(null);
  const pendingDetailRef = useRef<{
    generation: number;
    key: string;
    source: ViewerSource;
  } | null>(null);
  const detailGenerationRef = useRef(0);
  const detailSettledRef = useRef(false);
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastInteractionAtRef = useRef(0);
  const scheduleDetailOpenRef = useRef<() => void>(() => undefined);
  const updateDetailLoadingRef = useRef<() => void>(() => undefined);
  const descriptorRef = useRef(descriptor);
  const tilePlanRef = useRef<{ level: number; total: number } | null>(null);
  const loadedTilesRef = useRef(new Set<string>());
  descriptorRef.current = descriptor;
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSettled, setDetailSettled] = useState(false);
  const [tileProgress, setTileProgress] = useState({ loaded: 0, total: 0 });
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  previewSourceRef.current = previewSource;
  previewKeyRef.current = previewKey;
  imageRef.current = image;
  onCloseRef.current = onClose;
  const openDetailSource = () => {
    const viewer = viewerRef.current;
    const pending = pendingDetailRef.current;
    pendingDetailRef.current = null;
    if (detailTimerRef.current !== undefined) {
      clearTimeout(detailTimerRef.current);
      detailTimerRef.current = undefined;
    }
    if (!viewer || !pending) return;
    if (!openedPreviewKeyRef.current || detailItemRef.current) {
      setOriginalLoading(false);
      return;
    }
    const previewBounds = previewItemRef.current?.getBounds();
    detailKeyRef.current = pending.key;
    detailSettledRef.current = false;
    setDetailSettled(false);
    setDetailLoading(Boolean(descriptorRef.current));
    setTileProgress({ loaded: 0, total: 0 });
    loadedTilesRef.current.clear();
    tilePlanRef.current = null;
    viewer.addTiledImage({
      tileSource: pending.source,
      ...(previewBounds
        ? { x: previewBounds.x, y: previewBounds.y, width: previewBounds.width }
        : {}),
      success: (event) => {
        if (pending.generation !== detailGenerationRef.current || !viewerAliveRef.current) {
          if (viewerAliveRef.current) viewer.world.removeItem(event.item);
          return;
        }
        detailItemRef.current = event.item;
        // The viewer-level "fully-loaded-change" is an aggregate that does not
        // reset when a layer is added, so watch the detail layer itself.
        (
          event.item as ViewerWorldItem & {
            addHandler?: (name: 'fully-loaded-change', handler: () => void) => void;
          }
        ).addHandler?.('fully-loaded-change', updateDetailLoadingRef.current);
        updateDetailLoadingRef.current();
      },
      error: () => {
        if (pending.generation !== detailGenerationRef.current) return;
        detailKeyRef.current = null;
        detailItemRef.current = null;
        setDetailLoading(false);
        setOriginalLoading(false);
        setZoomActivated(false);
      },
    });
  };
  const scheduleDetailOpen = () => {
    if (detailTimerRef.current !== undefined) clearTimeout(detailTimerRef.current);
    const delay = Math.max(0, lastInteractionAtRef.current + PYRAMID_UPGRADE_IDLE_MS - Date.now());
    detailTimerRef.current = setTimeout(openDetailSource, delay);
  };
  scheduleDetailOpenRef.current = scheduleDetailOpen;
  const markDirectInteraction = () => {
    lastInteractionAtRef.current = Date.now();
    if (pendingDetailRef.current) scheduleDetailOpenRef.current();
  };
  useEffect(() => {
    const element = viewerElementRef.current;
    if (!element) return undefined;
    let cancelled = false;
    let resizeFrame = 0;
    void loadOpenSeadragon()
      .then(({ default: OpenSeadragon }) => {
        if (cancelled) return;
        const initialSource = previewSourceRef.current;
        const viewer = OpenSeadragon({
          element,
          tileSources: initialSource,
          maxImageCacheCount: 64,
          imageLoaderLimit: 4,
          showNavigationControl: false,
          showNavigator: false,
          animationTime: DIRECT_INTERACTION_ANIMATION_SECONDS,
          blendTime: 0,
          // Electron's WebGL drawer can miss its first texture commit until the viewport changes.
          drawer: 'canvas',
          immediateRender: true,
          loadDestinationTilesOnAnimation: true,
          maxZoomPixelRatio: MAX_ZOOM_PIXEL_RATIO,
          minScrollDeltaTime: 0,
          zoomPerScroll: 1.12,
          constrainDuringPan: false,
          visibilityRatio: 0.5,
        }) as unknown as ViewerHandle;
        const browserImageTarget = document.createElement('img');
        browserImageTarget.alt = '';
        browserImageTarget.setAttribute('aria-hidden', 'true');
        browserImageTarget.className = styles.browserImageTarget;
        browserImageTarget.dataset.testid = 'eagle-image-browser-target';
        browserImageTarget.decoding = 'async';
        browserImageTarget.draggable = false;
        browserImageTarget.src = imageRef.current.src;
        const updateDetailLoading = () => {
          if (cancelled) return;
          const item = detailItemRef.current;
          if (!item) {
            setDetailLoading(false);
            return;
          }
          const fullyLoaded = item.getFullyLoaded?.() ?? true;
          if (!fullyLoaded) {
            if (!detailSettledRef.current) setDetailLoading(true);
            return;
          }
          detailSettledRef.current = true;
          setDetailSettled(true);
          setDetailLoading(false);
          setOriginalLoading(false);
          const previewItem = previewItemRef.current;
          previewItemRef.current = null;
          if (previewItem) viewer.world.removeItem(previewItem);
        };
        updateDetailLoadingRef.current = updateDetailLoading;
        const onTileLoaded = (event?: unknown) => {
          updateDetailLoading();
          const payload = event as
            | { tile?: { level?: number; x?: number; y?: number }; tiledImage?: unknown }
            | undefined;
          if (payload?.tiledImage && payload.tiledImage !== detailItemRef.current) return;
          if (detailSettledRef.current) return;
          const tile = payload?.tile;
          const descriptor = descriptorRef.current;
          if (
            !tile ||
            !descriptor ||
            tile.level === undefined ||
            tile.x === undefined ||
            tile.y === undefined
          )
            return;
          const current = tilePlanRef.current;
          const key = `${tile.x}:${tile.y}`;
          if (!current || tile.level > current.level) {
            const total = computeTileTotal(descriptor, tile.level);
            tilePlanRef.current = { level: tile.level, total };
            loadedTilesRef.current.clear();
            loadedTilesRef.current.add(key);
            setTileProgress({ loaded: 1, total });
            return;
          }
          if (tile.level !== current.level) return;
          loadedTilesRef.current.add(key);
          setTileProgress({
            loaded: Math.min(loadedTilesRef.current.size, current.total),
            total: current.total,
          });
        };
        viewer.addHandler('fully-loaded-change', updateDetailLoading);
        viewer.addHandler('tile-loaded', onTileLoaded);
        viewer.addHandler('tile-load-failed', updateDetailLoading);
        viewer.addHandler('zoom', () => {
          if (!openedPreviewKeyRef.current) return;
          const home = viewer.viewport.getHomeZoom?.() ?? viewer.viewport.getZoom();
          if (viewer.viewport.getZoom() > home * 1.05) setZoomActivated(true);
        });
        viewer.addHandler('open', () => {
          openedPreviewKeyRef.current = requestedPreviewKeyRef.current;
          previewItemRef.current = viewer.world.getItemAt(0) ?? null;
          detailItemRef.current = null;
          detailKeyRef.current = null;
          const item = viewer.world.getItemAt(0);
          if (item) {
            browserImageTarget.src = imageRef.current.src;
            viewer.addOverlay({
              checkResize: false,
              element: browserImageTarget,
              location: item.getBounds(),
            });
          }
          viewer.forceRedraw();
          setStatus('ready');
          updateDetailLoading();
        });
        viewer.addHandler('after-resize', () => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (!cancelled) viewer.viewport.goHome(true);
          });
        });
        viewer.addHandler('open-failed', () => {
          openedPreviewKeyRef.current = '';
          setDetailLoading(false);
          setOriginalLoading(false);
          setStatus('error');
        });
        viewer.addHandler('canvas-click', (event) => {
          if (!event.quick) return;
          const item = viewer.world.getItemAt(0);
          if (!item) return;
          const viewportPoint = viewer.viewport.pointFromPixel(event.position, true);
          if (!item.getBounds().containsPoint(viewportPoint)) onCloseRef.current();
        });
        viewer.addHandler('canvas-drag', (event) => {
          if (!isDirectPointer(event.pointerType)) return;
          markDirectInteraction();
          event.preventDefaultAction = true;
          viewer.viewport.panBy(viewer.viewport.deltaPointsFromPixels(event.delta.negate()), true);
        });
        viewer.addHandler('canvas-drag-end', (event) => {
          if (!isDirectPointer(event.pointerType)) return;
          markDirectInteraction();
          event.preventDefaultAction = true;
          viewer.viewport.applyConstraints(false);
        });
        viewer.addHandler('canvas-scroll', (event) => {
          if (!isDirectPointer(event.pointerType)) return;
          markDirectInteraction();
          event.preventDefaultAction = true;
          const refPoint = viewer.viewport.pointFromPixel(event.position, true);
          viewer.viewport.zoomBy(Math.pow(viewer.zoomPerScroll, event.scroll), refPoint, true);
          viewer.viewport.applyConstraints(false);
        });
        viewerRef.current = viewer;
        viewerAliveRef.current = true;
        requestedPreviewKeyRef.current = previewKeyRef.current;
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      viewerAliveRef.current = false;
      cancelAnimationFrame(resizeFrame);
      if (detailTimerRef.current !== undefined) clearTimeout(detailTimerRef.current);
      detailGenerationRef.current += 1;
      viewerRef.current?.destroy();
      viewerRef.current = undefined;
    };
  }, [initializationAttempt]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (requestedPreviewKeyRef.current === previewKey || openedPreviewKeyRef.current === previewKey)
      return;
    requestedPreviewKeyRef.current = previewKey;
    detailGenerationRef.current += 1;
    pendingDetailRef.current = null;
    if (detailTimerRef.current !== undefined) {
      clearTimeout(detailTimerRef.current);
      detailTimerRef.current = undefined;
    }
    if (detailItemRef.current) {
      viewer.world.removeItem(detailItemRef.current);
      detailItemRef.current = null;
    }
    detailKeyRef.current = null;
    detailSettledRef.current = false;
    setDetailSettled(false);
    setDetailLoading(false);
    setTileProgress({ loaded: 0, total: 0 });
    setStatus('loading');
    viewer.open(previewSource);
  }, [previewKey, previewSource]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !highResolutionSource || !highResolutionKey) return;
    if (detailKeyRef.current === highResolutionKey) return;
    if (pendingDetailRef.current?.key === highResolutionKey) return;
    detailGenerationRef.current += 1;
    pendingDetailRef.current = {
      generation: detailGenerationRef.current,
      key: highResolutionKey,
      source: highResolutionSource,
    };
    if (detailItemRef.current) {
      viewer.world.removeItem(detailItemRef.current);
      detailItemRef.current = null;
    }
    detailKeyRef.current = null;
    detailSettledRef.current = false;
    setDetailSettled(false);
    lastInteractionAtRef.current = Date.now();
    scheduleDetailOpenRef.current();
  }, [highResolutionSource, highResolutionKey]);
  const retry = () => {
    const viewer = viewerRef.current;
    if (!viewer) {
      setStatus('loading');
      setInitializationAttempt((attempt) => attempt + 1);
      return;
    }
    detailSettledRef.current = false;
    setDetailSettled(false);
    setDetailLoading(false);
    setOriginalLoading(false);
    setStatus('loading');
    requestedPreviewKeyRef.current = previewKey;
    viewer.open(previewSource);
  };
  const displayStatus = error ? 'error' : loading ? 'loading' : status;
  const showDetailProgress =
    detailLoading &&
    tileProgress.total > 0 &&
    tileProgress.loaded > 0 &&
    tileProgress.loaded < tileProgress.total;
  const showOriginalProgress = originalLoading;
  const showOriginalBar = showOriginalProgress && originalPercent !== null;
  const showPreviewHint = previewLimited && !detailSettled;
  const qualityNotice =
    displayStatus === 'ready' && !loading
      ? descriptor
        ? detailLoading
          ? t('正在加载高清细节…')
          : showPreviewHint
            ? t('预览图 · 放大加载高清')
            : ''
        : showPreviewHint
          ? showOriginalProgress
            ? t('正在加载原图…')
            : t('预览图 · 放大加载高清')
          : ''
      : '';
  const qualityPercent = showDetailProgress
    ? Math.round((tileProgress.loaded / tileProgress.total) * 100)
    : showOriginalBar
      ? originalPercent
      : null;
  const qualityCount = showDetailProgress
    ? `${tileProgress.loaded}/${tileProgress.total}`
    : showOriginalBar
      ? `${originalPercent}%`
      : null;
  const secondary = (
    <>
      {!loading && !error && onLocate && image.assetId && (
        <EagleLocateAssetButton assetId={image.assetId} onLocate={onLocate} />
      )}
      <EagleImageCopyButton sourceUrl={image.src} />
      {actions}
      {collection}
    </>
  );
  return (
    <EagleViewerShell
      mobile={
        compact && asset
          ? mobileViewerPresentation(
              asset,
              onClose,
              onEdit,
              secondary,
              () => {
                rotation.current = (rotation.current + 90) % 360;
                viewerRef.current?.viewport.setRotation?.(rotation.current, true);
                viewerRef.current?.viewport.goHome(true);
              },
              readOnly || loading || Boolean(error),
            )
          : undefined
      }
      title={loading ? t('正在加载…') : image.alt}
      subtitle={loading ? undefined : subtitle}
      navigation={navigation}
      onClose={onClose}
      collection={collection}
      actions={
        <>
          {asset && (
            <EagleFavoriteButton
              assets={[asset]}
              disabled={readOnly || loading || Boolean(error)}
            />
          )}
          {!loading && !error && onLocate && image.assetId && (
            <EagleLocateAssetButton assetId={image.assetId} onLocate={onLocate} />
          )}
          {!loading && !error && <EagleImageCopyButton sourceUrl={image.src} />}
          {!loading && !error && onEdit && (
            <button type="button" data-viewer-primary onClick={onEdit}>
              <IconAdjustments size={17} />
              {editLabel ?? t('编辑照片')}
            </button>
          )}
          {actions}
        </>
      }
    >
      <EagleLivePhotoPlayback
        sourceUrl={loading ? undefined : image.motionSrc}
        posterUrl={image.src}
      />
      <div ref={viewerElementRef} className={styles.viewer} data-testid="eagle-image-viewer" />
      {qualityNotice && (
        <div className={styles.qualityNotice} role="status" aria-live="polite">
          <div className={styles.qualityLabel}>
            <span className={styles.qualityDot} aria-hidden="true" />
            <span>{qualityNotice}</span>
            {qualityCount && <span className={styles.qualityCount}>{qualityCount}</span>}
          </div>
          {qualityPercent !== null && (
            <div className={styles.qualityTrack} aria-hidden="true">
              <div className={styles.qualityBar} style={{ width: `${qualityPercent}%` }} />
            </div>
          )}
        </div>
      )}
      {displayStatus !== 'ready' ? (
        <div className={styles.loadState} role={displayStatus === 'error' ? 'alert' : 'status'}>
          {displayStatus === 'loading' && loadingPlaceholder ? (
            <div className={styles.thumbnailPlaceholder}>{loadingPlaceholder}</div>
          ) : null}
          {displayStatus === 'loading' ? (
            <>
              <div className={styles.progress} aria-hidden="true">
                <span />
              </div>
              <strong>{t('正在加载大图…')}</strong>
            </>
          ) : (
            <>
              <strong>{t('图片加载失败')}</strong>
              <span>{error ?? t('请检查网络后重试')}</span>
              <button type="button" onClick={onRetry ?? retry}>
                <IconRefresh size={16} />
                {' ' + t('重新加载') + ' '}
              </button>
            </>
          )}
        </div>
      ) : null}
    </EagleViewerShell>
  );
}
