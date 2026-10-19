import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { locateEagleAsset } from './eagle-asset-location';
import { decodeEagleAssetCursor } from './eagle-cursor';

test('location authorizes the target and bounds a scoped chronological context', async () => {
  const date = new Date('2024-03-01T12:00:00Z');
  let found = true;
  let neighbors = 21;
  type Query = { where: Record<string, unknown>; take?: number; orderBy?: unknown };
  const queries: Query[] = [];
  const db = {
    eagleAsset: {
      findFirst: async (query: Query) => {
        queries.push(query);
        return found ? { id: 'target', chronologicalAt: date, libraryAddedAt: date } : null;
      },
      findMany: async (query: Query) => {
        queries.push(query);
        return Array.from({ length: neighbors }, (_, index) => ({
          id: `newer-${index}`,
          chronologicalAt: date,
          libraryAddedAt: date,
        }));
      },
    },
  } as never;
  for (const libraryMode of ['PHOTO', 'MATERIAL'] as const) {
    const scope = { ownerId: 'owner', libraryMode };
    const result = await locateEagleAsset(db, scope, 'target', false);
    assert.equal(result.assetId, 'target');
    assert.equal(decodeEagleAssetCursor(result.cursor!, scope).id, 'newer-20');
    const [target, context] = queries.splice(0);
    assert.equal(target!.where.ownerId, 'owner');
    assert.equal(target!.where.libraryMode, libraryMode);
    assert.equal(target!.where.isPrivate, false);
    assert.equal(target!.where.deletedAt, null);
    assert.equal(context!.where.ownerId, 'owner');
    assert.equal(context!.where.libraryMode, libraryMode);
    assert.equal(context!.take, 21);
    assert.deepEqual(context!.orderBy, [
      { [libraryMode === 'PHOTO' ? 'chronologicalAt' : 'libraryAddedAt']: 'asc' },
      { id: 'asc' },
    ]);
  }
  neighbors = 3;
  assert.equal(
    (await locateEagleAsset(db, { ownerId: 'owner', libraryMode: 'PHOTO' }, 'target', true)).cursor,
    null,
  );
  queries.length = 0;
  found = false;
  await assert.rejects(
    () => locateEagleAsset(db, { ownerId: 'owner', libraryMode: 'PHOTO' }, 'target', false),
    NotFoundException,
  );
  assert.equal(queries.length, 1);
});
