import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planTransferPyramid,
  transferPyramidTiles,
  copyTransferPyramid,
} from './eagle-transfer-pyramid';
test('pyramid migration copies bounded independent tiles and checks counts, bytes and ownership', async () => {
  const row = {
    id: 'p',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'source',
    revision: 1,
    processorVersion: 'pyramid-v1',
    status: 'READY',
    storagePrefix: 'users/owner/assets/source/pyramid',
    tileSize: 512,
    overlap: 1,
    format: 'webp',
    width: 1,
    height: 1,
    maxLevel: 0,
    tileCount: 1,
    byteSize: 3n,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    lastError: null,
  };
  const plan = planTransferPyramid('owner', 'target', 1, [row] as never)!;
  assert.deepEqual(transferPyramidTiles(plan), ['0/0_0.webp']);
  const copies: string[][] = [];
  await copyTransferPyramid(
    {
      copyObject: async (a: string, b: string) => {
        copies.push([a, b]);
      },
      headObject: async () => ({ ContentLength: 3 }),
    } as never,
    'owner',
    plan,
  );
  assert.equal(copies.length, 1);
  assert.ok(copies[0]![1]!.startsWith('users/owner/assets/target/'));
  assert.equal(planTransferPyramid('owner', 'target', 2, [row] as never), undefined);
  assert.throws(() => planTransferPyramid('other', 'target', 1, [row] as never));
  assert.throws(() => transferPyramidTiles({ ...plan, tileCount: 2 }));
  assert.throws(() => transferPyramidTiles({ ...plan, maxLevel: 21 }));
  await assert.rejects(
    copyTransferPyramid(
      { copyObject: async () => {}, headObject: async () => ({ ContentLength: 2 }) } as never,
      'owner',
      plan,
    ),
    /总大小/,
  );
  let reads = 0;
  await assert.rejects(
    copyTransferPyramid(
      {
        copyObject: async () => {},
        headObject: async () => ({ ContentLength: ++reads === 1 ? 3 : 2 }),
      } as never,
      'owner',
      plan,
    ),
    /复制校验/,
  );
});
