import { EAGLE_OPERATION_REQUEST_TIMEOUT_MS } from './eagle-operation-request';
import type { AssetOperationKind, AssetOperationSummary } from '@sekereagle/library-core';
import { request } from './api-client';
import { libraryApiPath, type LibraryMode } from './library-api-scope';
export function createAssetOperationsApi(mode: LibraryMode) {
  const base = libraryApiPath('/api/eagle/operations', mode);
  return {
    list: (includePrivate = false, signal?: AbortSignal) =>
      request<AssetOperationSummary[]>(`${base}?publicOnly=${!includePrivate}`, { signal }),
    enqueue: (input: { operationId: string; kind: AssetOperationKind; assetIds: string[] }) =>
      request<AssetOperationSummary>(
        base,
        { method: 'POST', body: JSON.stringify(input) },
        EAGLE_OPERATION_REQUEST_TIMEOUT_MS,
      ),
    retry: (id: string) =>
      request<AssetOperationSummary>(
        `${base}/${encodeURIComponent(id)}/retry`,
        {
          method: 'POST',
          body: '{}',
        },
        EAGLE_OPERATION_REQUEST_TIMEOUT_MS,
      ),
    cancel: (id: string) =>
      request<AssetOperationSummary>(`${base}/${encodeURIComponent(id)}/cancel`, {
        method: 'POST',
        body: '{}',
      }),
  };
}
