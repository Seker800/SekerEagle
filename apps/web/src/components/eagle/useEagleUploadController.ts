import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
export type { EagleUploadItem } from '../../lib/library-upload-queue';

export function useEagleUploadController(accessToken: string, assetsQueryKey: QueryKey) {
  const {
    api: { uploadEagleAsset },
    ownerId,
    libraryMode,
  } = useLibraryWorkspace();
  const client = useQueryClient();
  const cache = getEagleWorkspaceCache(client, ownerId, libraryMode);
  useEffect(() => cache.retain(false), [cache]);
  const queue = cache.uploads;
  const items = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const scope = hashKey(assetsQueryKey);
  const uploads = items.filter((item) => item.scope === scope);
  const completed = uploads.filter((item) => item.state === 'completed').length;
  const pending = uploads.some((item) => item.state === 'queued' || item.state === 'uploading');
  return {
    importFiles: (files: File[]) =>
      queue.add(files, assetsQueryKey, (file, progress, signal) =>
        uploadEagleAsset(accessToken, file, progress, { signal }),
      ),
    uploads,
    uploadStatus: !uploads.length
      ? null
      : pending
        ? t('正在并行导入 · 已完成 {{value1}}/{{value2}}', {
            value1: completed,
            value2: uploads.length,
          })
        : t('导入完成 {{value1}}/{{value2}}', { value1: completed, value2: uploads.length }),
    dismissUploads: () => queue.dismiss(scope),
    retryUpload: (id: number) => queue.enqueue([id]),
  };
}
