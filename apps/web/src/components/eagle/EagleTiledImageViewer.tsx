import { useEffect, useRef } from 'react';
import type { EaglePyramidDescriptor } from '../../lib/eagle-api';
import { createEagleTileSource } from './eagle-media-sources';
import styles from './EagleTiledImageViewer.module.css';

export function EagleTiledImageViewer({
  descriptor,
  alt,
  onClose,
}: {
  descriptor: EaglePyramidDescriptor;
  alt: string;
  onClose: () => void;
}) {
  const viewerElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewerElementRef.current) return undefined;
    let cancelled = false;
    let viewer: { destroy(): void } | undefined;
    const element = viewerElementRef.current;
    void import('openseadragon').then(({ default: OpenSeadragon }) => {
      if (cancelled) return;
      viewer = OpenSeadragon({
        element,
        tileSources: createEagleTileSource(descriptor),
        maxImageCacheCount: 64,
        imageLoaderLimit: 4,
        showNavigationControl: false,
        showNavigator: true,
        navigatorAutoFade: true,
        animationTime: 0.6,
        blendTime: 0.1,
        constrainDuringPan: true,
        visibilityRatio: 0.5,
      });
    });
    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, [descriptor]);

  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        onClick={(event) => event.stopPropagation()}
      >
        <div ref={viewerElementRef} className={styles.viewer} data-testid="eagle-tiled-viewer" />
        <footer>
          <strong>{alt}</strong>
          <span>滚轮缩放 · 拖拽移动 · 仅加载视口附近切片</span>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
