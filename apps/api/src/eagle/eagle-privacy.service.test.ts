import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EaglePrivacyService } from './eagle-privacy.service';

test('privacy settings expose only the owner private-tag rules', async () => {
  const service = new EaglePrivacyService({
    eagleManualTag: {
      findMany: async () => [{ id: 'tag-private' }, { id: 'tag-sensitive' }],
    },
  } as never);

  assert.deepEqual(await service.getSettings('owner-a'), {
    tagIds: ['tag-private', 'tag-sensitive'],
  });
});

test('privacy settings fail closed when any selected tag belongs to another owner', async () => {
  let writes = 0;
  const transaction = {
    eagleManualTag: {
      count: async () => 1,
      updateMany: async () => {
        writes += 1;
      },
    },
  };
  const service = new EaglePrivacyService({
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  } as never);

  await assert.rejects(
    service.updateSettings('owner-a', { tagIds: ['tag-owned', 'tag-foreign'] }),
    NotFoundException,
  );
  assert.equal(writes, 0);
});

test('privacy settings replace tag rules and recompute only assets whose derived state changes', async () => {
  const tagWrites: unknown[] = [];
  const assetWrites: unknown[] = [];
  const transaction = {
    eagleManualTag: {
      count: async () => 2,
      updateMany: async (input: unknown) => {
        tagWrites.push(input);
        return { count: 1 };
      },
    },
    eagleAsset: {
      updateMany: async (input: unknown) => {
        assetWrites.push(input);
        return { count: 1 };
      },
    },
  };
  const service = new EaglePrivacyService({
    $transaction: async (work: (tx: typeof transaction) => unknown) => work(transaction),
  } as never);

  assert.deepEqual(
    await service.updateSettings('owner-a', { tagIds: ['tag-a', 'tag-b', 'tag-a'] }),
    { tagIds: ['tag-a', 'tag-b'] },
  );
  assert.equal(tagWrites.length, 2);
  assert.deepEqual(tagWrites[0], {
    where: { ownerId: 'owner-a', marksAssetsPrivate: true, id: { notIn: ['tag-a', 'tag-b'] } },
    data: { marksAssetsPrivate: false },
  });
  assert.deepEqual(tagWrites[1], {
    where: { ownerId: 'owner-a', id: { in: ['tag-a', 'tag-b'] } },
    data: { marksAssetsPrivate: true },
  });
  assert.equal(assetWrites.length, 2);
  assert.deepEqual(assetWrites[0], {
    where: {
      ownerId: 'owner-a',
      isPrivate: true,
      manualTagLinks: { none: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: false, rowVersion: { increment: 1 } },
  });
  assert.deepEqual(assetWrites[1], {
    where: {
      ownerId: 'owner-a',
      isPrivate: false,
      manualTagLinks: { some: { tag: { marksAssetsPrivate: true } } },
    },
    data: { isPrivate: true, rowVersion: { increment: 1 } },
  });
});
