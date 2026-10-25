import { useEffect, useMemo, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { AssetOperationKind, AssetOperationSummary } from '@sekereagle/library-core';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import type { LibraryMode } from '../../lib/library-api-scope';

export function useEnqueueAssetOperation() {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const api = useMemo(() => createAssetOperationsApi(libraryMode), [libraryMode]);
  const pendingIds = useRef(new Map<string, string>());
  return async (kind: AssetOperationKind, assetIds: string[] = []) => {
    const key = JSON.stringify([ownerId, libraryMode, kind, [...assetIds].sort()]);
    const operationId = pendingIds.current.get(key) ?? crypto.randomUUID();
    pendingIds.current.set(key, operationId);
    const operation = await api.enqueue({ operationId, kind, assetIds });
    pendingIds.current.delete(key);
    void client.invalidateQueries({ queryKey: ['eagle', ownerId, libraryMode, 'operations'] });
    return operation;
  };
}
export function useAssetOperationList(includePrivate: boolean, enabled = true) {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const apis = useMemo(
    () => ({
      MATERIAL: createAssetOperationsApi('MATERIAL'),
      PHOTO: createAssetOperationsApi('PHOTO'),
    }),
    [],
  );
  return useQueries({
    queries: (['MATERIAL', 'PHOTO'] as const).map((mode) => {
      const visible = includePrivate && mode === libraryMode;
      return {
        queryKey: ['eagle', ownerId, mode, 'operations', visible],
        queryFn: ({ signal }: { signal: AbortSignal }) => apis[mode].list(visible, signal),
        enabled,
        staleTime: 1000,
        refetchInterval: (query: { state: { data?: AssetOperationSummary[] } }) =>
          query.state.data?.some((operation) => operation.running || operation.queued)
            ? 1500
            : 10000,
        refetchIntervalInBackground: true,
      };
    }),
  });
}
/** Refresh only published results; accepting or failing a command must not hide its sources. */
export function useAssetOperationProgress(includePrivate: boolean, enabled: boolean) {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const queries = useAssetOperationList(includePrivate, enabled);
  const material = queries[0].data,
    photo = queries[1].data;
  const previous = useRef<Array<AssetOperationSummary[] | undefined>>([material, photo]);
  useEffect(() => {
    const snapshots = [material, photo];
    const published = snapshots.some(
      (rows, index) =>
        rows &&
        previous.current[index] &&
        rows.some(
          (row) =>
            row.completed >
            (previous.current[index]?.find((old) => old.id === row.id)?.completed ?? 0),
        ),
    );
    previous.current = snapshots;
    if (!published) return;
    for (const mode of ['MATERIAL', 'PHOTO'] as LibraryMode[]) {
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'eagle' &&
          query.queryKey[1] === ownerId &&
          query.queryKey[2] === mode &&
          query.queryKey[3] !== 'operations',
      });
    }
  }, [material, photo, client, ownerId]);
}
