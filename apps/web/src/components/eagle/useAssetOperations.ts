import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { ApiError } from '../../lib/api-error';
import { useEffect, useMemo, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { AssetOperationKind, AssetOperationSummary } from '@sekereagle/library-core';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getAssetOperationRefresher } from './asset-operation-refresh';

export function useEnqueueAssetOperation() {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const client = useQueryClient();
  const api = useMemo(() => createAssetOperationsApi(libraryMode), [libraryMode]);
  const pendingIds = useRef(new Map<string, string>());
  return async (kind: AssetOperationKind, assetIds: string[] = []) => {
    const key = JSON.stringify([ownerId, libraryMode, kind, [...assetIds].sort()]);
    const operationId = pendingIds.current.get(key) ?? crypto.randomUUID();
    pendingIds.current.set(key, operationId);
    const cache = getEagleWorkspaceCache(client, ownerId, libraryMode);
    const changes = cache.operations;
    cache.beginOperation(operationId, kind, assetIds);
    try {
      const operation = await api.enqueue({ operationId, kind, assetIds });
      pendingIds.current.delete(key);
      changes.observe(operation);
      void client.invalidateQueries({ queryKey: ['eagle', ownerId, libraryMode, 'operations'] });
      return operation;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      ) {
        changes.reject(operationId, error.message);
        await client.invalidateQueries({
          queryKey: ['eagle', ownerId, libraryMode, 'assets', 'library-count'],
        });
        changes.confirmCounts();
      } else changes.uncertain(operationId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
}
export function useAssetOperationList(includePrivate: boolean, enabled = true) {
  const client = useQueryClient();
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
          getEagleWorkspaceCache(client, ownerId, mode).operations.hasPending() ||
          query.state.data?.some((operation) => operation.running || operation.queued)
            ? 1500
            : 60000,
        refetchIntervalInBackground: false,
      };
    }),
  });
}
/** Observe durable outcomes in both modes even while a modal is closed. */
export function useAssetOperationProgress(includePrivate: boolean, enabled: boolean) {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const queries = useAssetOperationList(includePrivate, enabled);
  const material = queries[0].data,
    photo = queries[1].data;
  const materialUpdatedAt = queries[0].dataUpdatedAt,
    photoUpdatedAt = queries[1].dataUpdatedAt;
  const previous = useRef<Array<AssetOperationSummary[] | undefined>>([]);
  useEffect(() => {
    const snapshots = [material, photo];
    snapshots.forEach((rows, index) => {
      const mode = index === 0 ? 'MATERIAL' : 'PHOTO';
      const changes = getEagleWorkspaceCache(client, ownerId, mode).operations;
      for (const tracked of changes.entries) {
        if (tracked.pending && !rows?.some((row) => row.id === tracked.id))
          void getAssetOperationRefresher(client, ownerId).reconcile(mode, {
            id: tracked.id,
            kind: tracked.kind,
            libraryMode: mode,
            total: tracked.assetIds.length,
            completed: 0,
            running: 0,
            queued: 0,
            failed: 0,
            cancelled: 0,
            state: 'STOPPED',
            errors: [],
          });
      }
      for (const row of rows ?? []) {
        if (row.undoOf && changes.entries.some((entry) => entry.id === row.undoOf)) {
          changes.setUndo(row.undoOf, row.id);
          if (!changes.entries.some((entry) => entry.id === row.id))
            getEagleWorkspaceCache(client, ownerId, mode).beginOperation(row.id, 'RESTORE', []);
        }
        const tracked = changes.entries.find((entry) => entry.id === row.id);
        const old = previous.current[index]?.find((candidate) => candidate.id === row.id);
        if (tracked) changes.observe(row);
        if (
          !row.running &&
          !row.queued &&
          (tracked?.pending ||
            (previous.current[index] !== undefined && JSON.stringify(old) !== JSON.stringify(row)))
        ) {
          void getAssetOperationRefresher(client, ownerId).reconcile(mode, row);
        }
      }
    });
    previous.current = snapshots;
  }, [client, ownerId, material, photo, materialUpdatedAt, photoUpdatedAt]);
}
