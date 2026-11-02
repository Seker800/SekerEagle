import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryCommandRegistry } from './eagle-library-command';
import { EagleAssetOperationService } from './eagle-asset-operations.service';

test('command acceptance persists intent without waiting for the background privacy lock or running business work', async () => {
  const writes: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      assert.ok(!sql.join('').includes('sekereagle:privacy'));
      return [];
    },
    eagleAsset: { findMany: async () => [{ id: 'asset', mediaRevision: 2 }] },
    eagleAssetOperation: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return data;
      },
    },
    eagleAssetOperationItem: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        writes.push(...data);
        return { count: data.length };
      },
    },
  };
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) };
  const registry = new LibraryCommandRegistry();
  registry.register('ASSET_TAGS', {
    protocol: 'METADATA',
    apply: async () => {
      throw new Error('must never execute in HTTP');
    },
  });
  const service = new EagleAssetOperationService(
    db as never,
    undefined as never,
    undefined as never,
    'MATERIAL',
    undefined,
    registry,
  );
  const principal = { sub: 'owner', authVersion: 3, canViewPrivate: false } as never;
  const commands = service as unknown as {
    enqueueCommand: (
      principal: unknown,
      input: unknown,
    ) => Promise<{ state: string; queued: number }>;
  };
  const receipt = await commands.enqueueCommand(principal, {
    operationId: 'intent',
    type: 'ASSET_TAGS',
    payload: { addTagIds: ['tag'], removeTagIds: [] },
    assetIds: ['asset'],
  });
  assert.equal(receipt.state, 'QUEUED');
  assert.equal(receipt.queued, 1);
  assert.ok(writes.some((row) => row.ownerId === 'owner' && row.libraryMode === 'MATERIAL'));
});
