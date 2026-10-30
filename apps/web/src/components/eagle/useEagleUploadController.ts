import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useRef, useState } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { mapWithConcurrency } from '../../lib/async-pool';

const EAGLE_IMPORT_CONCURRENCY = 2;
export interface EagleUploadItem {
  id: number;
  scope: string;
  name: string;
  size: number;
  percent: number;
  state: 'queued' | 'uploading' | 'completed' | 'failed';
  error?: string;
}
export function useEagleUploadController(accessToken: string, assetsQueryKey: QueryKey) {
  const {
    api: { uploadEagleAsset },
  } = useLibraryWorkspace();
  const queryClient = useQueryClient();
  const scope = hashKey(assetsQueryKey);
  const [items, setItems] = useState<EagleUploadItem[]>([]);
  const nextId = useRef(0);
  const jobs = useRef(
    new Map<number, { run: () => Promise<void>; key: QueryKey; pending: boolean }>(),
  );
  // Multiple drops share the same two upload slots. A batch captures its original
  // API and cache scope, so later navigation cannot redirect queued files.
  const tail = useRef(Promise.resolve());
  const update = (id: number, patch: Partial<EagleUploadItem>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const enqueue = (ids: number[]) => {
    const ready = ids.filter((id) => {
      const job = jobs.current.get(id);
      if (!job || job.pending) return false;
      job.pending = true;
      update(id, { state: 'queued', percent: 0, error: undefined });
      return true;
    });
    if (!ready.length) return Promise.resolve();
    const pending = tail.current.then(async () => {
      const keys = new Map<string, QueryKey>();
      await mapWithConcurrency(ready, EAGLE_IMPORT_CONCURRENCY, async (id) => {
        const job = jobs.current.get(id)!;
        update(id, { state: 'uploading' });
        try {
          await job.run();
          update(id, { state: 'completed', percent: 100 });
          keys.set(hashKey(job.key), job.key);
        } catch (error) {
          update(id, {
            state: 'failed',
            error: error instanceof Error ? error.message : t('导入失败'),
          });
        } finally {
          job.pending = false;
        }
      });
      await Promise.all(
        [...keys.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    });
    tail.current = pending.catch(() => undefined);
    return pending;
  };
  const importFiles = (files: File[]) => {
    const added = files.map((file) => {
      const id = ++nextId.current;
      jobs.current.set(id, {
        pending: false,
        key: assetsQueryKey,
        run: async () => {
          await uploadEagleAsset(accessToken, file, (progress) =>
            update(id, { percent: progress.percent }),
          );
        },
      });
      return { id, scope, name: file.name, size: file.size, percent: 0, state: 'queued' as const };
    });
    setItems((current) => [...current, ...added]);
    return enqueue(added.map((item) => item.id));
  };
  const uploads = items.filter((item) => item.scope === scope);
  const completed = uploads.filter((item) => item.state === 'completed').length;
  const pending = uploads.some((item) => item.state === 'queued' || item.state === 'uploading');
  const uploadStatus = !uploads.length
    ? null
    : pending
      ? t('正在并行导入 · 已完成 {{value1}}/{{value2}}', {
          value1: completed,
          value2: uploads.length,
        })
      : t('导入完成 {{value1}}/{{value2}}', { value1: completed, value2: uploads.length });
  const dismissUploads = () => {
    const dismissed = new Set(
      uploads
        .filter((item) => item.state === 'completed' || item.state === 'failed')
        .map((item) => item.id),
    );
    for (const id of dismissed) jobs.current.delete(id);
    setItems((current) => current.filter((item) => !dismissed.has(item.id)));
  };
  return {
    importFiles,
    uploadStatus,
    uploads,
    dismissUploads,
    retryUpload: (id: number) => enqueue([id]),
  };
}
