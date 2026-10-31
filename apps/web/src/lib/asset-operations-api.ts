import { EAGLE_OPERATION_REQUEST_TIMEOUT_MS } from './eagle-operation-request';
import type {
  AssetOperationKind,
  AssetOperationSummary,
  AssetOperationResults,
} from '@sekereagle/library-core';
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
    results: (
      id: string,
      query: { cursor?: number; revision?: string } = {},
      signal?: AbortSignal,
    ) =>
      request<AssetOperationResults>(
        `${base}/${encodeURIComponent(id)}/results?${new URLSearchParams(
          Object.entries(query)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        )}`,
        { signal },
      ),
    undo: (id: string, operationId: string) =>
      request<AssetOperationSummary>(
        `${base}/${encodeURIComponent(id)}/undo`,
        {
          method: 'POST',
          body: JSON.stringify({ operationId }),
        },
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
