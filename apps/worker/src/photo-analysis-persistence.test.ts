import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoExif } from './photo-analysis';
import { persistPhotoAnalysis } from './photo-analysis-persistence';

test('rendering edited pixels preserves inherited capture data and the original timeline position', async () => {
  const capturedAt = new Date('2020-05-10T09:30:00Z');
  const inherited = { ...normalizePhotoExif({ Model: 'X-Pro3', DateTimeOriginal: '2020:05:10 09:30:00' }), captureMetadataInherited: true };
  let written: any;
  let time: any;
  const tx = {
    eaglePhotoMetadata: {
      findFirst: async ({ where }: any) => {
        assert.deepEqual(where, { ownerId: 'owner', libraryMode: 'PHOTO', assetId: 'copy', assetRevision: 2 });
        return inherited;
      },
      upsert: async ({ create }: any) => { written = create; },
    },
    eagleAsset: { updateMany: async ({ data }: any) => { time = data.chronologicalAt; } },
  };
  await persistPhotoAnalysis(tx as never, { id: 'copy', ownerId: 'owner', libraryMode: 'PHOTO', chronologicalAt: capturedAt, libraryAddedAt: new Date() } as never, { ...normalizePhotoExif({}), sharpnessScore: 8, perceptualHash: 'new-hash' }, 2);
  assert.equal(written.cameraModel, 'X-Pro3');
  assert.equal(written.capturedAt.toISOString(), capturedAt.toISOString());
  assert.equal(written.sharpnessScore, 8);
  assert.equal(written.perceptualHash, 'new-hash');
  assert.equal(written.captureMetadataInherited, true);
  assert.equal(time.toISOString(), capturedAt.toISOString());
});
