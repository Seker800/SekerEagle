import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPhoto } from '@tabler/icons-react';
import {
  getEagleAssetContentUrl,
  getEagleRenditionContentUrl,
  type EagleAssetListItem,
} from '../../lib/eagle-api';
import { type MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import styles from './SekerEaglePage.module.css';
import { getEagleThumbnailSourceSet } from './eagle-media-sources';

const RENDITION_PRIORITY = ['THUMBNAIL', 'POSTER', 'PREVIEW'];
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;
const ATTEMPTS_PER_RENDITION = 2;
const VIDEO_HOVER_DELAY_MS = 500;

function retryDelayMs(assetId: string, attempt: number): number {
  let hash = attempt;
  for (const character of assetId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const jitter = 0.8 + (hash % 401) / 1_000;
  return Math.round(
    Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)) * jitter,
  );
}

export function getEagleAssetThumbnailUrls(asset: EagleAssetListItem): string[] {
  return [
    ...new Set(
      RENDITION_PRIORITY.flatMap((kind) =>
        asset.renditions
          .filter((rendition) => rendition.kind === kind)
          .sort(
            (left, right) =>
              (left.width ?? Number.MAX_SAFE_INTEGER) - (right.width ?? Number.MAX_SAFE_INTEGER),
          )
          .map((rendition) => getEagleRenditionContentUrl(asset.id, rendition.id)),
      ),
    ),
  ];
}

export function EagleAssetThumbnail({
  asset,
  scheduler,
  order,
  displayWidth,
  alt = '',
}: {
  asset: EagleAssetListItem;
  scheduler: MediaLoadScheduler;
  order: number;
  displayWidth: number;
  alt?: string;
}) {
  const urls = useMemo(() => getEagleAssetThumbnailUrls(asset), [asset]);
  const responsiveSource = useMemo(() => getEagleThumbnailSourceSet(asset), [asset]);
  const sourceKey = urls.join('\u0000');
  const [attempt, setAttempt] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [isVideoPreviewActive, setIsVideoPreviewActive] = useState(false);
  const settleRef = useRef<(() => void) | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const videoHoverTimerRef = useRef<number | null>(null);
  const maxAttempts = urls.length * ATTEMPTS_PER_RENDITION;
  const source = urls.length > 0 ? urls[Math.floor(attempt / ATTEMPTS_PER_RENDITION)] : undefined;

  const clearRetryTimer = () => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  const clearVideoHoverTimer = () => {
    if (videoHoverTimerRef.current === null) return;
    window.clearTimeout(videoHoverTimerRef.current);
    videoHoverTimerRef.current = null;
  };

  useEffect(() => {
    clearRetryTimer();
    settleRef.current?.();
    settleRef.current = null;
    setAttempt(0);
    setActiveSource(null);
    setFailed(false);
    setIsVideoPreviewActive(false);
  }, [sourceKey]);

  useEffect(() => {
    if (!source || failed) return undefined;
    return scheduler.enqueue({
      id: `eagle-thumbnail:${asset.id}`,
      priority: 'visible',
      order,
      run: (signal) =>
        new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            signal.removeEventListener('abort', handleAbort);
            if (settleRef.current === settle) settleRef.current = null;
            resolve();
          };
          const handleAbort = () => {
            setActiveSource((current) => (current === source ? null : current));
            settle();
          };

          if (signal.aborted) {
            settle();
            return;
          }
          signal.addEventListener('abort', handleAbort, { once: true });
          settleRef.current = settle;
          setActiveSource(source);
        }),
    });
  }, [asset.id, attempt, failed, order, scheduler, source]);

  useEffect(
    () => () => {
      clearRetryTimer();
      clearVideoHoverTimer();
      settleRef.current?.();
      settleRef.current = null;
    },
    [],
  );

  const handleLoad = () => {
    settleRef.current?.();
  };

  const handleError = () => {
    settleRef.current?.();
    setActiveSource(null);
    if (retryTimerRef.current !== null) return;
    const nextAttempt = attempt + 1;
    if (nextAttempt >= maxAttempts) {
      setFailed(true);
      return;
    }
    retryTimerRef.current = window.setTimeout(
      () => {
        retryTimerRef.current = null;
        setAttempt(nextAttempt);
      },
      retryDelayMs(asset.id, nextAttempt),
    );
  };

  const retry = () => {
    clearRetryTimer();
    settleRef.current?.();
    settleRef.current = null;
    setActiveSource(null);
    setFailed(false);
    setAttempt(0);
  };

  let thumbnailContent;
  if (failed) {
    thumbnailContent = (
      <span className={styles.thumbnailError} onClick={retry}>
        <IconPhoto size={30} />
        <span>缩略图加载失败，点击素材重试</span>
      </span>
    );
  } else if (!activeSource) {
    thumbnailContent = <IconPhoto size={30} aria-label="正在加载缩略图" />;
  } else {
    thumbnailContent = (
      <img
        src={activeSource}
        srcSet={responsiveSource?.src === activeSource ? responsiveSource.srcSet : undefined}
        sizes={`${Math.max(1, Math.round(displayWidth))}px`}
        alt={alt}
        draggable={false}
        onLoad={handleLoad}
        onError={handleError}
      />
    );
  }

  const isVideo = asset.mimeType.startsWith('video/');
  return (
    <span
      className={styles.thumbnailMedia}
      onMouseEnter={() => {
        if (!isVideo || videoHoverTimerRef.current !== null || isVideoPreviewActive) return;
        videoHoverTimerRef.current = window.setTimeout(() => {
          videoHoverTimerRef.current = null;
          setIsVideoPreviewActive(true);
        }, VIDEO_HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearVideoHoverTimer();
        setIsVideoPreviewActive(false);
      }}
    >
      {thumbnailContent}
      {isVideoPreviewActive && (
        <video
          className={styles.thumbnailVideo}
          src={getEagleAssetContentUrl(asset.id)}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
