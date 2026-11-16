import { useLibraryWorkspace } from '../../lib/library-workspace';
import { t } from '../../i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { hashKey, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
export type { EagleUploadItem } from '../../lib/library-upload-queue';

export function useEagleUploadController(accessToken: string, assetsQueryKey: QueryKey) {
  const {
    api: { uploadEagleAsset, getEagleUploadStatuses },
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
  const uploaded = uploads.filter(
    (item) => item.state === 'uploaded' || item.state === 'completed',
  ).length;
  const completed = uploads.filter((item) => item.state === 'completed').length;
  const pending = uploads.some(
    (item) => item.state === 'queued' || item.state === 'uploading' || item.state === 'uploaded',
  );
  return {
    importFiles: (files: File[]) =>
      queue.add(
        files,
        assetsQueryKey,
        async (file, progress, signal) => {
          const result = await uploadEagleAsset(accessToken, file, progress, {
            signal,
            waitForFinalization: false,
          });
          return result.assetId ? undefined : { sessionId: result.uploadSessionId };
        },
        (sessionIds, signal) => getEagleUploadStatuses(accessToken, sessionIds, signal),
      ),
    uploads,
    uploadStatus: !uploads.length
      ? null
      : pending
        ? t('已上传 {{value1}}/{{value2}} · 入库 {{value3}}/{{value2}}', {
            value1: uploaded,
            value2: uploads.length,
            value3: completed,
          })
        : t('导入完成 {{value1}}/{{value2}}', { value1: completed, value2: uploads.length }),
    dismissUploads: () => queue.dismiss(scope),
    retryUpload: (id: number) => queue.enqueue([id]),
  };
}
