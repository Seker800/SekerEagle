import type { AssetOperationSummary } from '@sekereagle/library-core';
import type { QueryClient } from '@tanstack/react-query';
import type { LibraryMode } from './library-api-scope';
import { getEagleWorkspaceCache } from '../components/eagle/eagle-workspace-cache';
import { createEagleQueryKeys } from '../components/eagle/eagle-query-keys';

export type OperationResponse<T> = T | AssetOperationSummary;
export function isAcceptedOperation(value: unknown): value is AssetOperationSummary {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AssetOperationSummary>;
  return (
    typeof row.id === 'string' &&
    typeof row.kind === 'string' &&
    (row.libraryMode === 'PHOTO' || row.libraryMode === 'MATERIAL') &&
    typeof row.total === 'number' &&
    typeof row.completed === 'number' &&
    typeof row.queued === 'number' &&
    typeof row.running === 'number' &&
    typeof row.failed === 'number' &&
    typeof row.cancelled === 'number' &&
    typeof row.state === 'string' &&
    Array.isArray(row.errors)
  );
}
/** The receipt owns progress; acceptance never waits for execution or list reads. */
export function observeAcceptedOperation(
  client: QueryClient,
  ownerId: string,
  mode: LibraryMode,
  value: unknown,
): value is AssetOperationSummary {
  if (!isAcceptedOperation(value) || value.libraryMode !== mode) return false;
  const cache = getEagleWorkspaceCache(client, ownerId, mode);
  const current = cache.operations.entries.find((entry) => entry.id === value.id);
  if (current?.summary && JSON.stringify(current.summary) === JSON.stringify(value)) return true;
  cache.beginOperation(value.id, value.kind, []);
  cache.operations.observe(value);
  void client.invalidateQueries({ queryKey: createEagleQueryKeys(ownerId, mode).operations });
  return true;
}
