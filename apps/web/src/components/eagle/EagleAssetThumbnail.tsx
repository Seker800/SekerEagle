import { useEffect, useMemo, useRef, useState } from 'react';
import { IconPhoto } from '@tabler/icons-react';
import { getEagleRenditionContentUrl, type EagleAssetListItem } from '../../lib/eagle-api';
import { type MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import styles from './SekerEaglePage.module.css';

const RENDITION_PRIORITY = ['THUMBNAIL', 'POSTER', 'PREVIEW'];
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 4_000;
const ATTEMPTS_PER_RENDITION = 2;

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
          .map((rendition) => getEagleRenditionContentUrl(asset.id, rendition.id)),
      ),
    ),
  ];
}

export function EagleAssetThumbnail({
  asset,
  scheduler,
  order,
  alt = '',
}: {
  asset: EagleAssetListItem;
  scheduler: MediaLoadScheduler;
  order: number;
  alt?: string;
}) {
  const urls = useMemo(() => getEagleAssetThumbnailUrls(asset), [asset]);
  const sourceKey = urls.join('\u0000');
  const [attempt, setAttempt] = useState(0);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const settleRef = useRef<(() => void) | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const maxAttempts = urls.length * ATTEMPTS_PER_RENDITION;
  const source =
    urls.length > 0 ? urls[Math.floor(attempt / ATTEMPTS_PER_RENDITION)] : undefined;

  const clearRetryTimer = () => {
    if (retryTimerRef.current === null) return;
    window.clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  useEffect(() => {
    clearRetryTimer();
    settleRef.current?.();
    settleRef.current = null;
    setAttempt(0);
    setActiveSource(null);
    setFailed(false);
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
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setAttempt(nextAttempt);
    }, retryDelayMs(asset.id, nextAttempt));
  };

  const retry = () => {
    clearRetryTimer();
    settleRef.current?.();
    settleRef.current = null;
    setActiveSource(null);
    setFailed(false);
    setAttempt(0);
  };

  if (failed) {
    return (
      <span className={styles.thumbnailError} onClick={retry}>
        <IconPhoto size={30} />
        <span>缩略图加载失败，点击素材重试</span>
      </span>
    );
  }
  if (!activeSource) return <IconPhoto size={30} aria-label="正在加载缩略图" />;
  return (
    <img src={activeSource} alt={alt} draggable={false} onLoad={handleLoad} onError={handleError} />
  );
}
