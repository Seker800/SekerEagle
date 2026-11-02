import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { isAcceptedOperation, observeAcceptedOperation } from './accepted-operation';
import { getEagleWorkspaceCache } from '../components/eagle/eagle-workspace-cache';
import type { AssetOperationSummary } from '@sekereagle/library-core';
const summary: AssetOperationSummary = {
  id: 'queued-command',
  kind: 'METADATA_COMMAND',
  libraryMode: 'PHOTO',
  total: 2,
  completed: 0,
  running: 0,
  queued: 2,
  failed: 0,
  cancelled: 0,
  state: 'QUEUED',
  errors: [],
};
it('registers the durable receipt in the matching owner and mode without waiting for reads', () => {
  const client = new QueryClient();
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(new Promise(() => undefined));
  expect(observeAcceptedOperation(client, 'owner-a', 'PHOTO', summary)).toBe(true);
  expect(getEagleWorkspaceCache(client, 'owner-a', 'PHOTO').operations.hasPending()).toBe(true);
  expect(getEagleWorkspaceCache(client, 'owner-b', 'PHOTO').operations.hasPending()).toBe(false);
  expect(getEagleWorkspaceCache(client, 'owner-a', 'MATERIAL').operations.hasPending()).toBe(false);
  expect(invalidate).toHaveBeenCalledOnce();
});
it('does not confuse counts or completed data with an accepted operation or cross modes', () => {
  const client = new QueryClient();
  expect(isAcceptedOperation({ queued: 2 })).toBe(false);
  expect(isAcceptedOperation(undefined)).toBe(false);
  expect(observeAcceptedOperation(client, 'owner', 'MATERIAL', summary)).toBe(false);
  expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL').operations.hasPending()).toBe(false);
});
