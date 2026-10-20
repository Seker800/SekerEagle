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
