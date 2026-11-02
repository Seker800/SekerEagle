import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleAssetOperationService } from './eagle-asset-operations.service';
import { LibraryCommandRegistry } from './eagle-library-command';

test('sixty thousand identical command partitions store their immutable common payload once', async () => {
  const payload = { lut: 'numeric-table-once', recipe: { version: 1 } };
  let storedOperation: Record<string, unknown> | undefined;
  let storedItems = 0;
  let repeatedPayloads = 0;
  const tx = {
    $queryRaw: async () => [],
    eagleAsset: { findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, mediaRevision: 1 })) },
    eagleAssetOperation: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { storedOperation = data; return data; },
    },
    eagleAssetOperationItem: { createMany: async ({ data }: { data: Array<{ snapshots: { payload: Record<string, unknown>; sharedPayload?: boolean } }> }) => {
      storedItems += data.length;
      repeatedPayloads += data.filter(({ snapshots }) => snapshots.payload.lut !== undefined || snapshots.sharedPayload !== true).length;
      return { count: data.length };
    } },
  };
  const registry = new LibraryCommandRegistry();
  registry.register('BATCH_EDIT_RENDER', { protocol: 'METADATA',
    partition: (input, ids) => ids.map((id) => ({ payload: input, assetIds: [id] })),
    apply: async () => undefined });
  const service = new EagleAssetOperationService({ $transaction: async (work: (db: typeof tx) => Promise<unknown>) => work(tx) } as never,
    undefined as never, undefined as never, 'PHOTO', undefined, registry);
  await service.enqueueCommand({ sub: 'owner', authVersion: 1, canViewPrivate: false } as never,
    { operationId: 'operation', type: 'BATCH_EDIT_RENDER', payload,
      assetIds: Array.from({ length: 60000 }, (_, index) => `asset-${index}`) });
  assert.equal(storedItems, 60000);
  assert.equal(repeatedPayloads, 0);
  assert.deepEqual(storedOperation?.commandPayload, payload);
});
