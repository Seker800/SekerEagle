import { IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import type { PreviewImage } from '../media/image-preview/useImagePreviewState';
import { createEaglePreviewTileSource, createEagleTileSource } from './eagle-media-sources';
import styles from './EagleImageViewer.module.css';

type ViewerStatus = 'loading' | 'ready' | 'error';
type ViewerSource = ReturnType<typeof createEaglePreviewTileSource | typeof createEagleTileSource>;
type ViewerPoint = { x: number; y: number };

interface ViewerDragEvent {
  delta: { negate(): ViewerPoint };
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
  applyConstraints(immediately?: boolean): void;
  deltaPointsFromPixels(point: ViewerPoint): ViewerPoint;
  getCenter(current?: boolean): ViewerPoint;
  getZoom(current?: boolean): number;
  panBy(point: ViewerPoint, immediately?: boolean): void;
  panTo(point: ViewerPoint, immediately?: boolean): void;
  pointFromPixel(point: ViewerPoint, current?: boolean): ViewerPoint;
  zoomBy(factor: number, refPoint?: ViewerPoint, immediately?: boolean): void;
  zoomTo(zoom: number, refPoint?: ViewerPoint, immediately?: boolean): void;
}

interface ViewerWorldItem {
  getBounds(): { containsPoint(point: ViewerPoint): boolean };
}

interface ViewerHandle {
  addHandler(name: 'open' | 'open-failed', handler: () => void): void;
  addHandler(name: 'canvas-click', handler: (event: ViewerClickEvent) => void): void;
  addHandler(name: 'canvas-drag', handler: (event: ViewerDragEvent) => void): void;
  addHandler(name: 'canvas-drag-end', handler: (event: ViewerDragEndEvent) => void): void;
  addHandler(name: 'canvas-scroll', handler: (event: ViewerScrollEvent) => void): void;
  destroy(): void;
  forceRedraw(): void;
  open(source: ViewerSource): void;
  viewport: ViewerViewport;
  world: { getItemAt(index: number): ViewerWorldItem | undefined };
  zoomPerScroll: number;
}

interface PendingSource {
  imageKey: string;
  preserveViewport: boolean;
  source: ViewerSource;
  sourceKey: string;
}

interface ViewportSnapshot {
  center: ViewerPoint;
  zoom: number;
}

const DIRECT_INTERACTION_ANIMATION_SECONDS = 0.08;
const PYRAMID_UPGRADE_IDLE_MS = 120;

function isDirectPointer(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
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
  descriptor,
  onClose,
}: {
  image: PreviewImage;
  descriptor?: EaglePyramidDescriptor;
  onClose: () => void;
}) {
  const source = useMemo(
    () =>
      descriptor ? createEagleTileSource(descriptor) : createEaglePreviewTileSource(image.src),
    [descriptor, image.src],
  );
  const sourceKey = descriptor ? `pyramid:${descriptor.id}` : `preview:${image.src}`;
  const viewerElementRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<ViewerHandle | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  const sourceRef = useRef<ViewerSource>(source);
  const desiredSourceKeyRef = useRef(sourceKey);
  const sourceKeyRef = useRef('');
  const activeImageKeyRef = useRef(image.assetId ?? image.src);
  const pendingSourceRef = useRef<PendingSource | null>(null);
  const pendingViewportRef = useRef<ViewportSnapshot | null>(null);
  const sourceOpenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastInteractionAtRef = useRef(0);
  const schedulePendingSourceOpenRef = useRef<() => void>(() => undefined);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  sourceRef.current = source;
  desiredSourceKeyRef.current = sourceKey;
  onCloseRef.current = onClose;

  const openPendingSource = () => {
    const viewer = viewerRef.current;
    const pending = pendingSourceRef.current;
    if (!viewer || !pending) return;

    pendingSourceRef.current = null;
    sourceOpenTimerRef.current = undefined;
    pendingViewportRef.current = pending.preserveViewport
      ? {
          center: viewer.viewport.getCenter(true),
          zoom: viewer.viewport.getZoom(true),
        }
      : null;
    sourceKeyRef.current = pending.sourceKey;
    activeImageKeyRef.current = pending.imageKey;
    setStatus('loading');
    viewer.open(pending.source);
  };

  const schedulePendingSourceOpen = () => {
    if (sourceOpenTimerRef.current !== undefined) clearTimeout(sourceOpenTimerRef.current);
    const delay = Math.max(0, lastInteractionAtRef.current + PYRAMID_UPGRADE_IDLE_MS - Date.now());
    sourceOpenTimerRef.current = setTimeout(openPendingSource, delay);
  };
  schedulePendingSourceOpenRef.current = schedulePendingSourceOpen;

  const markDirectInteraction = () => {
    lastInteractionAtRef.current = Date.now();
    if (pendingSourceRef.current) schedulePendingSourceOpenRef.current();
  };

  useEffect(() => {
    const element = viewerElementRef.current;
    if (!element) return undefined;

    let cancelled = false;
    void loadOpenSeadragon()
      .then(({ default: OpenSeadragon }) => {
        if (cancelled) return;
        const initialSource = sourceRef.current;
        const viewer = OpenSeadragon({
          element,
          tileSources: initialSource,
          maxImageCacheCount: 64,
          imageLoaderLimit: 4,
          showNavigationControl: false,
          showNavigator: true,
          navigatorAutoFade: true,
          animationTime: DIRECT_INTERACTION_ANIMATION_SECONDS,
          blendTime: 0,
          immediateRender: true,
          loadDestinationTilesOnAnimation: true,
          minScrollDeltaTime: 0,
          zoomPerScroll: 1.12,
          constrainDuringPan: false,
          visibilityRatio: 0.5,
        }) as unknown as ViewerHandle;
        viewer.addHandler('open', () => {
          const pendingViewport = pendingViewportRef.current;
          pendingViewportRef.current = null;
          if (pendingViewport) {
            viewer.viewport.zoomTo(pendingViewport.zoom, undefined, true);
            viewer.viewport.panTo(pendingViewport.center, true);
            viewer.viewport.applyConstraints(true);
          }
          viewer.forceRedraw();
          setStatus('ready');
        });
        viewer.addHandler('open-failed', () => setStatus('error'));
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
        sourceKeyRef.current = desiredSourceKeyRef.current;
        activeImageKeyRef.current = image.assetId ?? image.src;
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      if (sourceOpenTimerRef.current !== undefined) clearTimeout(sourceOpenTimerRef.current);
      viewerRef.current?.destroy();
      viewerRef.current = undefined;
    };
  }, [initializationAttempt]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || sourceKeyRef.current === sourceKey) return;
    const imageKey = image.assetId ?? image.src;
    const preserveViewport =
      activeImageKeyRef.current === imageKey &&
      sourceKeyRef.current.startsWith('preview:') &&
      sourceKey.startsWith('pyramid:');
    pendingSourceRef.current = { imageKey, preserveViewport, source, sourceKey };
    if (preserveViewport) {
      lastInteractionAtRef.current = Date.now();
      schedulePendingSourceOpen();
      return;
    }
    if (sourceOpenTimerRef.current !== undefined) clearTimeout(sourceOpenTimerRef.current);
    openPendingSource();
  }, [image.assetId, image.src, source, sourceKey]);

  const retry = () => {
    const viewer = viewerRef.current;
    if (!viewer) {
      setStatus('loading');
      setInitializationAttempt((attempt) => attempt + 1);
      return;
    }
    setStatus('loading');
    viewer.open(sourceRef.current);
  };

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={image.alt}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.stage}>
          <div ref={viewerElementRef} className={styles.viewer} data-testid="eagle-image-viewer" />
          {status !== 'ready' ? (
            <div className={styles.loadState} role={status === 'error' ? 'alert' : 'status'}>
              {status === 'loading' ? (
                <>
                  <div className={styles.progress} aria-hidden="true">
                    <span />
                  </div>
                  <strong>正在加载大图…</strong>
                </>
              ) : (
                <>
                  <strong>图片加载失败</strong>
                  <span>请检查网络后重试</span>
                  <button type="button" onClick={retry}>
                    <IconRefresh size={16} />
                    重新加载
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
        <footer>
          <strong>{image.alt}</strong>
          <span>滚轮缩放 · 拖拽移动 · {descriptor ? '按需加载高清切片' : '优化预览'}</span>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
