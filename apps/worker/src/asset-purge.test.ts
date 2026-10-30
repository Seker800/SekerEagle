import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAssetPurge } from './asset-purge';

for (const handedOff of [false, true])
  test(`purge detaches restrictive pointers and ${handedOff ? 'preserves handed-off objects' : 'deletes owned objects'}`, async () => {
    const events: string[] = [];
    const asset = {
      storageTransferredOut: handedOff,
      id: 'asset',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      originalObjectKey: 'users/owner/original',
      renditions: [{ storageKey: 'users/owner/preview' }],
      imagePyramids: [{ storagePrefix: 'users/owner/tiles' }],
    };
    const tx = {
      $queryRaw: async () => [],
      eagleAssetProcessingJob: { updateMany: async () => ({ count: 1 }) },
      eagleAsset: {
        findFirst: async () => asset,
        deleteMany: async () => {
          events.push('asset');
          return { count: 1 };
        },
      },
      uploadSession: { updateMany: async () => events.push('upload') },
      eagleUploadSessionState: { updateMany: async () => events.push('state') },
      eagleBrowserCapture: { updateMany: async () => events.push('capture') },
      eagleObjectDeletion: {
        create: async ({ data }: { data: { objectKeys: string[]; prefixes: string[] } }) => {
          events.push('outbox');
          assert.deepEqual(data.objectKeys, ['users/owner/original', 'users/owner/preview']);
          assert.deepEqual(data.prefixes, ['users/owner/tiles/']);
        },
      },
    };
    await prepareAssetPurge(
      tx as never,
      {
        id: 'job',
        assetId: 'asset',
        ownerId: 'owner',
        libraryMode: 'PHOTO',
        assetRevision: 1,
        leaseVersion: 1,
      } as never,
    );
    assert.deepEqual(events, [
      ...(handedOff ? [] : ['outbox']),
      'upload',
      'state',
      'state',
      'capture',
      'asset',
    ]);
  });

test('an expired purge lease cannot delete a DB row or queue object removal', async () => {
  let touched = false;
  await prepareAssetPurge(
    {
      eagleAssetProcessingJob: { updateMany: async () => ({ count: 0 }) },
      eagleAsset: {
        findFirst: async () => {
          touched = true;
        },
      },
    } as never,
    { id: 'job', leaseVersion: 1 } as never,
  );
  assert.equal(touched, false);
});
