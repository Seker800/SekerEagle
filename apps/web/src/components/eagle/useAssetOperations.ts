import { useEffect, useMemo, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { AssetOperationKind, AssetOperationSummary } from '@sekereagle/library-core';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { AssetOperationRefresher } from './asset-operation-refresh';
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
            : 60000,
        refetchIntervalInBackground: false,
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
  const refresher = useRef<AssetOperationRefresher | null>(null);
  const publishedOperations = useRef(new Set<string>());
  useEffect(() => {
    const queue = new AssetOperationRefresher(client, ownerId);
    refresher.current = queue;
    previous.current = [undefined, undefined];
    publishedOperations.current.clear();
    return () => {
      queue.dispose();
      if (refresher.current === queue) refresher.current = null;
    };
  }, [client, ownerId]);
  useEffect(() => {
    const snapshots = [material, photo];
    const affected = new Map<LibraryMode, boolean>();
    snapshots.forEach((rows, index) => {
      const before = previous.current[index];
      if (!before) return;
      for (const row of rows ?? []) {
        if (row.kind === 'DUPLICATE_SCAN') continue;
        const old = before.find((candidate) => candidate.id === row.id);
        const published = row.completed > (old?.completed ?? 0);
        if (published) publishedOperations.current.add(row.id);
        const finished =
          !row.running &&
          !row.queued &&
          !!old &&
          (!!old.running || !!old.queued) &&
          publishedOperations.current.has(row.id);
        if (!published && !finished) continue;
        const final = !row.running && !row.queued;
        affected.set(row.libraryMode, final || !!affected.get(row.libraryMode));
        if (row.kind === 'SEND') {
          const target = row.libraryMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
          affected.set(target, final || !!affected.get(target));
        }
        if (final) publishedOperations.current.delete(row.id);
      }
    });
    for (const [mode, final] of affected) refresher.current?.schedule(mode, final);
    previous.current = snapshots;
  }, [material, photo]);
}
