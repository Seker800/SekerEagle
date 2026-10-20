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
