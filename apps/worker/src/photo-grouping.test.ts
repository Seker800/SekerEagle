import assert from 'node:assert/strict';
import test from 'node:test';
import { groupAnalyzedPhoto } from './photo-grouping';

test('new automatic matches keep an edited cover ahead of a sharper original', async () => {
  for (const edited of [true, false]) {
    const rows = ['source', 'copy', 'new'].map((assetId, i) => ({
      assetId,
      capturedAt: new Date(`2024-01-01T12:00:0${i}Z`),
      cameraModel: 'camera',
      perceptualHash: '0'.repeat(16),
      sharpnessScore: i === 0 ? 100 : 5,
      assetRevision: 1,
      asset: { mimeType: 'image/jpeg' },
    }));
    let updates = 0;
    const tx = {
      $executeRaw: async () => {},
      eaglePhotoMetadata: {
        findFirst: async () => ({ ...rows[2], asset: { isPrivate: false } }),
        findMany: async () => rows,
      },
      eaglePhotoGroup: {
        findMany: async () => [
          {
            id: 'group',
            kind: 'SIMILAR',
            dismissed: false,
            bestSelectedByUser: false,
            members: [{ assetId: 'source' }, { assetId: 'copy' }],
            bestAsset: { deletedAt: null, photoMetadata: { captureMetadataInherited: edited } },
          },
        ],
        updateMany: async () => {
          updates++;
        },
      },
      eaglePhotoGroupMember: { createMany: async () => {} },
    };
    await groupAnalyzedPhoto(tx as never, 'owner', 'new');
    assert.equal(updates, edited ? 0 : 1);
  }
});

test('a new RAW and JPEG match stores the camera-rendered JPEG as the group cover', async () => {
  const rows = ['raw', 'jpeg'].map((assetId, i) => ({
    assetId,
    capturedAt: new Date(`2024-01-01T12:00:0${i}Z`),
    cameraModel: 'camera',
    perceptualHash: '0'.repeat(16),
    sharpnessScore: i === 0 ? 100 : 5,
    assetRevision: 1,
    asset: { mimeType: i === 0 ? 'image/x-adobe-dng' : 'image/jpeg' },
  }));
  const created: Array<{ bestAssetId?: string | null }> = [];
  const tx = {
    $executeRaw: async () => {},
    eaglePhotoMetadata: {
      findFirst: async () => ({ ...rows[1], asset: { isPrivate: false } }),
      findMany: async () => rows,
    },
    eaglePhotoGroup: {
      findMany: async () => [],
      create: async ({ data }: { data: { bestAssetId?: string | null } }) => {
        created.push(data);
        return { id: 'group', ...data };
      },
    },
    eaglePhotoGroupMember: { createMany: async () => {} },
  };
  await groupAnalyzedPhoto(tx as never, 'owner', 'jpeg');
  assert.equal(created[0]?.bestAssetId, 'jpeg');
});
