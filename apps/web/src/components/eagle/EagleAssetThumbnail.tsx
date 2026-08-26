import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconPhoto } from '@tabler/icons-react';
import {
  getEagleAssetContentUrl,
  getEagleRenditionContentUrl,
  type EagleAssetListItem,
} from '../../lib/eagle-api';
import { type MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import {
  ThumbnailLoadError,
  type LoadedThumbnail,
  type ThumbnailLoadService,
} from '../media/loading/thumbnailLoadService';
import styles from './SekerEaglePage.module.css';

const RENDITION_PRIORITY = ['THUMBNAIL', 'POSTER', 'PREVIEW'];
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;
const ATTEMPTS_PER_RENDITION = 2;
const THUMBNAIL_LOAD_TIMEOUT_MS = 12_000;
const VIDEO_HOVER_DELAY_MS = 500;

function retryDelayMs(assetId: string, attempt: number): number {
  let hash = attempt;
  for (const character of assetId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const jitter = 0.8 + (hash % 401) / 1_000;
  return Math.round(
    Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1)) * jitter,
  );
}

export function getEagleAssetThumbnailUrls(
  asset: EagleAssetListItem,
  targetPixelWidth: number,
): string[] {
  return RENDITION_PRIORITY.flatMap((kind) => {
    const candidates = asset.renditions
      .filter((rendition) => rendition.kind === kind && rendition.revision === asset.mediaRevision)
      .sort(
        (left, right) =>
          (left.width ?? Number.MAX_SAFE_INTEGER) - (right.width ?? Number.MAX_SAFE_INTEGER),
      );
    const selected =
      candidates.find((rendition) => (rendition.width ?? 0) >= targetPixelWidth) ??
      candidates.at(-1);
    return selected ? [getEagleRenditionContentUrl(asset.id, selected.id, selected.kind)] : [];
  });
}

export function EagleAssetThumbnail({
  asset,
  scheduler,
  loadService,
  order,
  displayWidth,
  alt = '',
}: {
  asset: EagleAssetListItem;
  scheduler: MediaLoadScheduler;
  loadService?: ThumbnailLoadService;
  order: number;
  displayWidth: number;
  alt?: string;
}) {
  const targetPixelWidth = Math.max(
    1,
    Math.ceil(displayWidth * (globalThis.devicePixelRatio || 1)),
  );
  const urls = useMemo(
    () => getEagleAssetThumbnailUrls(asset, targetPixelWidth),
    [asset, targetPixelWidth],
  );
  const sourceKey = urls.join('\u0000');
  const [attempt, setAttempt] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [requestCycle, setRequestCycle] = useState(0);
  const [isVideoPreviewActive, setIsVideoPreviewActive] = useState(false);
  const settleRef = useRef<(() => void) | null>(null);
  const loadTimeoutRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const videoHoverTimerRef = useRef<number | null>(null);
  const loadedThumbnailRef = useRef<LoadedThumbnail | null>(null);
  const transientRetriesRef = useRef(0);
  const maxAttempts = urls.length * ATTEMPTS_PER_RENDITION;
  const source = urls.length > 0 ? urls[Math.floor(attempt / ATTEMPTS_PER_RENDITION)] : undefined;
  const taskId = `eagle-thumbnail:${asset.id}`;

  const clearRetryTimer = () => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current === null) return;
    window.clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = null;
  }, []);

  const clearVideoHoverTimer = () => {
    if (videoHoverTimerRef.current === null) return;
    window.clearTimeout(videoHoverTimerRef.current);
    videoHoverTimerRef.current = null;
  };

  const releaseLoadedThumbnail = useCallback(() => {
    loadedThumbnailRef.current?.release();
    loadedThumbnailRef.current = null;
  }, []);

  useEffect(() => {
    clearLoadTimeout();
    clearRetryTimer();
    settleRef.current?.();
    settleRef.current = null;
    releaseLoadedThumbnail();
    setAttempt(0);
    setActiveSource(null);
    setFailed(false);
    transientRetriesRef.current = 0;
    setIsVideoPreviewActive(false);
  }, [clearLoadTimeout, releaseLoadedThumbnail, sourceKey]);

  const handleFailure = useCallback(
    (failedSource: string, skipRemainingAttempts = false) => {
      clearLoadTimeout();
      settleRef.current?.();
      releaseLoadedThumbnail();
      setActiveSource((current) => (current === failedSource ? null : current));
      if (retryTimerRef.current !== null) return;
      const nextAttempt = skipRemainingAttempts
        ? (Math.floor(attempt / ATTEMPTS_PER_RENDITION) + 1) * ATTEMPTS_PER_RENDITION
        : attempt + 1;
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
    },
    [asset.id, attempt, clearLoadTimeout, maxAttempts, releaseLoadedThumbnail],
  );

  const handleRequestFailure = useCallback(
    (failedSource: string, error: unknown) => {
      if (
        error instanceof ThumbnailLoadError &&
        (error.failure === 'rate-limited' || error.failure === 'transient')
      ) {
        if (error.failure === 'transient') {
          transientRetriesRef.current += 1;
          if (transientRetriesRef.current > 2) {
            setFailed(true);
            return;
          }
        }
        const retryAfterMs = Math.max(500, error.retryAfterMs);
        scheduler.coolDown(retryAfterMs);
        if (retryTimerRef.current !== null) return;
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setRequestCycle((cycle) => cycle + 1);
        }, retryAfterMs);
        return;
      }
      if (error instanceof ThumbnailLoadError && error.failure === 'unauthorized') {
        setFailed(true);
        return;
      }
      handleFailure(failedSource, error instanceof ThumbnailLoadError);
    },
    [handleFailure, scheduler],
  );

  useEffect(() => {
    scheduler.reprioritize(taskId, { priority: 'visible', order });
  }, [order, scheduler, taskId]);

  useEffect(() => {
    if (!source || failed) return undefined;
    return scheduler.enqueue({
      id: taskId,
      priority: 'visible',
      order,
      run: async (signal) => {
        let displaySource = source;
        if (loadService && source.startsWith('/api/')) {
          try {
            const loaded = await loadService.load(
              `${asset.id}:${asset.mediaRevision}:${source}`,
              source,
              signal,
            );
            if (signal.aborted) {
              loaded.release();
              return;
            }
            releaseLoadedThumbnail();
            loadedThumbnailRef.current = loaded;
            transientRetriesRef.current = 0;
            displaySource = loaded.url;
          } catch (error) {
            if (!signal.aborted) handleRequestFailure(source, error);
            return;
          }
        }
        await new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            clearLoadTimeout();
            signal.removeEventListener('abort', handleAbort);
            if (settleRef.current === settle) settleRef.current = null;
            resolve();
          };
          const handleAbort = () => {
            setActiveSource((current) => (current === displaySource ? null : current));
            releaseLoadedThumbnail();
            settle();
          };

          if (signal.aborted) {
            settle();
            return;
          }
          signal.addEventListener('abort', handleAbort, { once: true });
          settleRef.current = settle;
          setActiveSource(displaySource);
          loadTimeoutRef.current = window.setTimeout(
            () => handleFailure(displaySource),
            THUMBNAIL_LOAD_TIMEOUT_MS,
          );
        });
      },
    });
  }, [
    asset.id,
    asset.mediaRevision,
    attempt,
    clearLoadTimeout,
    failed,
    handleFailure,
    handleRequestFailure,
    loadService,
    releaseLoadedThumbnail,
    requestCycle,
    scheduler,
    source,
    taskId,
  ]);

  useEffect(
    () => () => {
      clearLoadTimeout();
      clearRetryTimer();
      clearVideoHoverTimer();
      settleRef.current?.();
      settleRef.current = null;
      releaseLoadedThumbnail();
    },
    [clearLoadTimeout, releaseLoadedThumbnail],
  );

  const handleLoad = () => {
    clearLoadTimeout();
    settleRef.current?.();
  };

  const handleError = () => {
    if (activeSource) handleFailure(activeSource);
  };

  const retry = () => {
    clearRetryTimer();
    clearLoadTimeout();
    settleRef.current?.();
    settleRef.current = null;
    releaseLoadedThumbnail();
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
