import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';

test('unauthorized or mixed source IDs fail before any object copy or operation plan', async () => {
  let copied = 0;
  const db = {
    eagleLibraryTransfer: { findUnique: async () => null },
    eagleAsset: {
      findMany: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, {
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          id: { in: ['foreign'] },
          deletedAt: null,
          isPrivate: false,
        });
        return [];
      },
    },
  } as never;
  const storage = {
    copyObject: async () => {
      copied++;
    },
  } as never;
  await assert.rejects(
    () =>
      new EagleLibraryTransferService(db, storage, 'PHOTO').send(
        'owner',
        { operationId: 'op', assetIds: ['foreign'] },
        false,
      ),
    NotFoundException,
  );
  assert.equal(copied, 0);
});

test('approval snapshot mismatch fails before a transfer plan or any object copy', async () => {
  let writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      upsert: async () => {
        writes++;
      },
    },
    eagleAsset: { findMany: async () => [{ id: 'photo', mediaRevision: 2, rowVersion: 1 }] },
  } as never;
  const storage = {
    copyObject: async () => {
      writes++;
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(db, storage, 'PHOTO').send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(writes, 0);
});

test('an edit between approval validation and plan creation cannot silently replace the approved version', async () => {
  let reads = 0,
    writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      upsert: async () => {
        writes++;
      },
    },
    eagleAsset: {
      findMany: async () => [
        {
          id: 'photo',
          mediaRevision: 1,
          rowVersion: ++reads === 1 ? 1 : 2,
          mimeType: 'image/jpeg',
          lifecycleStatus: 'READY',
        },
      ],
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(
      db,
      {
        copyObject: async () => {
          writes++;
        },
      } as never,
      'PHOTO',
    ).send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});
