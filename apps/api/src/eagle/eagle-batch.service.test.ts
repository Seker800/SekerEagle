import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EagleService } from './eagle.service';

test('batch asset update rejects a stale member before mutating any asset', async () => {
  let writes = 0;
  const transaction = {
    eagleAsset: {
      findMany: async () => [
        { id: 'asset-a', rowVersion: 3 },
        { id: 'asset-b', rowVersion: 8 },
      ],
      updateMany: async () => {
        writes += 1;
        return { count: 2 };
      },
    },
  };
  const prisma = {
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  };
  const service = new EagleService(prisma as never);

  await assert.rejects(
    service.batchUpdate('owner-a', {
      assets: [
        { assetId: 'asset-a', rowVersion: 3 },
        { assetId: 'asset-b', rowVersion: 7 },
      ],
      rating: 5,
    }),
    ConflictException,
  );
  assert.equal(writes, 0);
});

test('batch tag changes fail closed before writes when any asset belongs elsewhere', async () => {
  let transactions = 0;
  const prisma = {
    eagleAsset: { findMany: async () => [{ id: 'asset-a' }] },
    eagleManualTag: { findMany: async () => [{ id: 'tag-a' }] },
    $transaction: async () => {
      transactions += 1;
    },
  };
  const service = new EagleService(prisma as never);

  await assert.rejects(
    service.batchChangeManualTags('owner-a', {
      assetIds: ['asset-a', 'asset-from-other-owner'],
      addTagIds: ['tag-a'],
      removeTagIds: [],
    }),
    NotFoundException,
  );
  assert.equal(transactions, 0);
});

test('batch clear removes every manual tag and distance for owned assets without enumerating tags', async () => {
  const deletes: Array<{ table: string; where: unknown }> = [];
  const suggestionRefreshes: unknown[] = [];
  const transaction = {
    eagleAssetManualTag: {
      deleteMany: async ({ where }: { where: unknown }) => {
        deletes.push({ table: 'manual-tags', where });
        return { count: 3 };
      },
    },
    eagleTagMemberDistance: {
      deleteMany: async ({ where }: { where: unknown }) => {
        deletes.push({ table: 'tag-distances', where });
        return { count: 3 };
      },
    },
    $queryRaw: async (statement: unknown) => {
      suggestionRefreshes.push(statement);
      return [{ scanned: 2, matched: 1 }];
    },
  };
  const prisma = {
    eagleAsset: { findMany: async () => [{ id: 'asset-a' }, { id: 'asset-b' }] },
    eagleManualTag: { findMany: async () => [] },
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  };
  const service = new EagleService(prisma as never);

  const result = await service.batchChangeManualTags('owner-a', {
    assetIds: ['asset-a', 'asset-b'],
    addTagIds: [],
    removeTagIds: [],
    clearAll: true,
  } as never);

  assert.deepEqual(result, { affectedAssetCount: 2 });
  assert.deepEqual(deletes, [
    {
      table: 'manual-tags',
      where: { ownerId: 'owner-a', assetId: { in: ['asset-a', 'asset-b'] } },
    },
    {
      table: 'tag-distances',
      where: { ownerId: 'owner-a', assetId: { in: ['asset-a', 'asset-b'] } },
    },
  ]);
  assert.equal(suggestionRefreshes.length, 1);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /owner-a/);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /asset-a/);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /asset-b/);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /EagleAssetEmbedding/);
});

test('batch tag removal refreshes only assets that end without any manual tag', async () => {
  const suggestionRefreshes: unknown[] = [];
  const transaction = {
    eagleAssetManualTag: { deleteMany: async () => ({ count: 1 }) },
    eagleTagMemberDistance: { deleteMany: async () => ({ count: 1 }) },
    $queryRaw: async (statement: unknown) => {
      suggestionRefreshes.push(statement);
      return [{ scanned: 1, matched: 1 }];
    },
  };
  const service = new EagleService({
    eagleAsset: { findMany: async () => [{ id: 'asset-a' }, { id: 'asset-b' }] },
    eagleManualTag: { findMany: async () => [{ id: 'tag-a' }] },
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  } as never);

  await service.batchChangeManualTags('owner-a', {
    assetIds: ['asset-a', 'asset-b'],
    addTagIds: [],
    removeTagIds: ['tag-a'],
  });

  assert.equal(suggestionRefreshes.length, 1);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /manualTag/);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /asset-a/);
  assert.match(JSON.stringify(suggestionRefreshes[0]), /asset-b/);
});

test('large batch tag additions split relation inserts into bounded chunks', async () => {
  const assetIds = Array.from({ length: 201 }, (_, index) => `asset-${index}`);
  const tagIds = Array.from({ length: 100 }, (_, index) => `tag-${index}`);
  const insertedRows: number[] = [];
  let distanceSyncs = 0;
  const transaction = {
    eagleAssetManualTag: {
      updateMany: async () => ({ count: 0 }),
      createMany: async ({ data }: { data: unknown[] }) => {
        insertedRows.push(data.length);
        return { count: data.length };
      },
    },
    $executeRaw: async () => {
      distanceSyncs += 1;
      return 0;
    },
  };
  const prisma = {
    eagleAsset: { findMany: async () => assetIds.map((id) => ({ id })) },
    eagleManualTag: { findMany: async () => tagIds.map((id) => ({ id })) },
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  };
  const service = new EagleService(prisma as never);

  await service.batchChangeManualTags('owner-a', {
    assetIds,
    addTagIds: tagIds,
    removeTagIds: [],
  });

  assert.deepEqual(insertedRows, [10_000, 10_000, 100]);
  assert.equal(distanceSyncs, 3);
});

test('batch trash rejects inside the transaction so partial updates roll back', async () => {
  let rejectionWasInsideTransaction = false;
  const service = new EagleService({
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => {
      try {
        return await callback({ eagleAsset: { updateMany: async () => ({ count: 1 }) } });
      } catch (error) {
        rejectionWasInsideTransaction = true;
        throw error;
      }
    },
  } as never);

  await assert.rejects(
    service.setTrash('owner-1', ['asset-1', 'asset-2'], false),
    /一个或多个素材不存在/,
  );
  assert.equal(rejectionWasInsideTransaction, true);
});
