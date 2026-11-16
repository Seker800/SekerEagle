import { useLibraryWorkspace } from '../../lib/library-workspace';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { UploadDedupeChecker } from '../../lib/upload-dedupe';
export type { EagleUploadItem } from '../../lib/library-upload-queue';

export interface EagleUploadSummary {
  total: number;
  uploaded: number;
  completed: number;
  duplicate: number;
  failed: number;
  waiting: number;
  percent: number;
  bytesPerSecond: number;
  remainingSeconds: number | null;
  paused: boolean;
}

function transferredBytes(items: ReturnType<typeof useUploads>) {
  let bytes = 0;
  for (const item of items) {
    if (item.state === 'completed' || item.state === 'duplicate' || item.state === 'uploaded')
      bytes += item.size;
    else if (item.state === 'uploading') bytes += (item.size * item.percent) / 100;
  }
  return bytes;
}

function useUploads(queue: ReturnType<typeof getEagleWorkspaceCache>['uploads']) {
  return useSyncExternalStore(queue.subscribe, queue.snapshot);
}

export function useEagleUploadController(assetsQueryKey: QueryKey) {
  const {
    api: { uploadEagleAsset, getEagleUploadStatuses, checkEagleUploadContentBatch },
    ownerId,
    libraryMode,
  } = useLibraryWorkspace();
  const client = useQueryClient();
  const cache = getEagleWorkspaceCache(client, ownerId, libraryMode);
  useEffect(() => cache.retain(false), [cache]);
  const queue = cache.uploads;
  const allItems = useUploads(queue);
  const itemsRef = useRef(allItems);
  itemsRef.current = allItems;
  const [speed, setSpeed] = useState({ bytes: 0, at: 0, speed: 0 });
  const dedupe = useMemo(
    () =>
      new UploadDedupeChecker((items, signal) =>
        checkEagleUploadContentBatch(items, signal),
      ),
    [checkEagleUploadContentBatch],
  );
  const scope = hashKey(assetsQueryKey);
  const uploads = allItems.filter((item) => item.scope === scope);
  const completed = uploads.filter((item) => item.state === 'completed').length;
  const duplicate = uploads.filter((item) => item.state === 'duplicate').length;
  const failed = uploads.filter((item) => item.state === 'failed').length;
  const waiting = uploads.filter(
    (item) =>
      item.state === 'queued' ||
      item.state === 'checking' ||
      item.state === 'uploading' ||
      item.state === 'uploaded',
  ).length;
  const totalBytes = uploads.reduce((sum, item) => sum + item.size, 0);
  const doneBytes = transferredBytes(uploads);
  const pending = waiting > 0;

  useEffect(() => {
    if (!pending) {
      setSpeed({ bytes: 0, at: 0, speed: 0 });
      return;
    }
    setSpeed({ bytes: transferredBytes(itemsRef.current), at: performance.now(), speed: 0 });
    const timer = setInterval(() => {
      const bytes = transferredBytes(itemsRef.current);
      setSpeed((previous) => {
        const now = performance.now();
        const instant = previous.at ? (bytes - previous.bytes) / ((now - previous.at) / 1000) : 0;
        const smoothed = previous.speed ? previous.speed * 0.65 + instant * 0.35 : instant;
        return { bytes, at: now, speed: Math.max(0, smoothed) };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const remainingBytes = Math.max(0, totalBytes - doneBytes);
  const summary: EagleUploadSummary = {
    total: uploads.length,
    uploaded: completed + uploads.filter((item) => item.state === 'uploaded').length,
    completed,
    duplicate,
    failed,
    waiting,
    percent: totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0,
    bytesPerSecond: pending ? speed.speed : 0,
    remainingSeconds: pending && speed.speed > 0 ? Math.ceil(remainingBytes / speed.speed) : null,
    paused: queue.paused,
  };

  return {
    importFiles: (files: File[]) =>
      queue.add(
        files,
        assetsQueryKey,
        async (file, progress, signal) => {
          progress({ percent: 0, phase: 'checking' });
          const { sha256, exists } = await dedupe.check(file, signal);
          if (exists) return { duplicate: true };
          const result = await uploadEagleAsset(file, progress, {
            signal,
            waitForFinalization: false,
            ...(sha256 ? { contentSha256: sha256 } : {}),
          });
          if (result.duplicate) return { duplicate: true };
          return result.assetId ? undefined : { sessionId: result.uploadSessionId };
        },
        (sessionIds, signal) => getEagleUploadStatuses(sessionIds, signal),
      ),
    uploads,
    summary,
    pauseUploads: queue.pauseAll,
    resumeUploads: queue.resumeAll,
    retryAllFailed: () => queue.retryAllFailed(scope),
    dismissUploads: () => queue.dismiss(scope),
    retryUpload: (id: number) => queue.enqueue([id]),
  };
}
