import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncAssetPrivacy, inheritedPrivacyTag } from './index';

test('empty photo scope never updates other assets', async () => {
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => {
      throw new Error('unexpected write');
    },
  };
  assert.equal(await syncAssetPrivacy(tx as never, 'owner', [], 'PHOTO'), 0);
});
test('inherited privacy never turns an existing public tag private', async () => {
  const created: string[] = [];
  const tx = {
    eagleManualTag: {
      upsert: async (input: {
        update: unknown;
        create: { name: string; ownerId: string; libraryMode: string };
      }) => {
        assert.deepEqual(input.update, {});
        assert.equal(input.create.ownerId, 'owner');
        assert.equal(input.create.libraryMode, 'PHOTO');
        created.push(input.create.name);
        return { id: 'private', marksAssetsPrivate: created.length === 2 };
      },
    },
  };
  assert.equal(await inheritedPrivacyTag(tx as never, 'owner', 'PHOTO'), 'private');
  assert.deepEqual(created, ['继承私密', '继承私密 2']);
});
test('inherited privacy fails closed if all labels collide with public labels', async () => {
  const tx = { eagleManualTag: { upsert: async () => ({ marksAssetsPrivate: false }) } };
  await assert.rejects(inheritedPrivacyTag(tx as never, 'owner', 'PHOTO'), /无法创建/);
});

test('material scope preserves manual tag semantics and counts changed assets', async () => {
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    eagleAsset: {
      updateMany: async (input: {
        where: { ownerId: string; libraryMode: string; id?: { in: string[] } };
      }) => {
        assert.equal(input.where.ownerId, 'owner');
        assert.equal(input.where.libraryMode, 'MATERIAL');
        assert.deepEqual(input.where.id?.in, ['one']);
        writes++;
        return { count: 1 };
      },
    },
  };
  assert.equal(await syncAssetPrivacy(tx as never, 'owner', ['one']), 2);
  assert.equal(writes, 2);
});
