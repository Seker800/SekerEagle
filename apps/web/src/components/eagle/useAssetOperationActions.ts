import { ApiError } from '../../lib/api-error';
import { createDuplicatesApi } from '../../lib/eagle-duplicates-api';
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AssetOperationSummary } from '@sekereagle/library-core';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
export function useAssetOperationActions() {
  const { ownerId } = useLibraryWorkspace();
  const client = useQueryClient();
  const undoIds = useRef(new Map<string, string>());
  return useMutation({
    mutationFn: async ({
      operation,
      action,
    }: {
      operation: Pick<AssetOperationSummary, 'id' | 'kind' | 'libraryMode'>;
      action: 'retry' | 'cancel' | 'undo';
    }) => {
      const api = createAssetOperationsApi(operation.libraryMode);
      if (action === 'retry') return api.retry(operation.id);
      if (action === 'cancel') return api.cancel(operation.id);
      const id = undoIds.current.get(operation.id) ?? crypto.randomUUID();
      undoIds.current.set(operation.id, id);
      try {
        return await api.undo(operation.id, id);
      } catch (error) {
        const tracked = getEagleWorkspaceCache(
          client,
          ownerId,
          operation.libraryMode,
        ).operations.entries.find((row) => row.id === operation.id);
        if (!(error instanceof ApiError) || error.status !== 404 || !tracked?.pending) throw error;
        // A timed-out admission may still commit. Confirm the same idempotent
        // intent before compensating it; never infer cancellation from a 404 race.
        if (tracked.duplicateInput)
          await createDuplicatesApi(operation.libraryMode).cleanup(tracked.duplicateInput);
        else
          await api.enqueue({
            operationId: tracked.id,
            kind: tracked.kind,
            assetIds: tracked.requestAssetIds,
          });
        return api.undo(operation.id, id);
      }
    },
    onSuccess: (result, { operation, action }) => {
      const changes = getEagleWorkspaceCache(client, ownerId, operation.libraryMode).operations;
      if (action === 'undo') {
        changes.setUndo(operation.id, result.id);
        changes.begin(result.id, 'RESTORE', []);
      } else if (action === 'retry') changes.resume(operation.id);
      changes.observe(result);
      void client.invalidateQueries({
        queryKey: ['eagle', ownerId, operation.libraryMode, 'operations'],
      });
    },
  });
}
