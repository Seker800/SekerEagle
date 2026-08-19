import { IconRefresh } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import type { PreviewImage } from '../media/image-preview/useImagePreviewState';
import { createEaglePreviewTileSource, createEagleTileSource } from './eagle-media-sources';
import styles from './EagleImageViewer.module.css';

type ViewerStatus = 'loading' | 'ready' | 'error';
type ViewerSource = ReturnType<typeof createEaglePreviewTileSource | typeof createEagleTileSource>;

interface ViewerHandle {
  addHandler(name: 'open' | 'open-failed', handler: () => void): void;
  destroy(): void;
  open(source: ViewerSource): void;
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
  const sourceRef = useRef<ViewerSource>(source);
  const desiredSourceKeyRef = useRef(sourceKey);
  const sourceKeyRef = useRef('');
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [initializationAttempt, setInitializationAttempt] = useState(0);
  sourceRef.current = source;
  desiredSourceKeyRef.current = sourceKey;

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
          animationTime: 0.3,
          blendTime: 0.1,
          immediateRender: true,
          constrainDuringPan: true,
          visibilityRatio: 0.5,
        }) as unknown as ViewerHandle;
        viewer.addHandler('open', () => setStatus('ready'));
        viewer.addHandler('open-failed', () => setStatus('error'));
        viewerRef.current = viewer;
        sourceKeyRef.current = desiredSourceKeyRef.current;
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = undefined;
    };
  }, [initializationAttempt]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || sourceKeyRef.current === sourceKey) return;
    sourceKeyRef.current = sourceKey;
    setStatus('loading');
    viewer.open(source);
  }, [source, sourceKey]);

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
