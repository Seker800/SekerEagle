import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoExif } from './photo-analysis';
import { persistPhotoAnalysis } from './photo-analysis-persistence';

test('rendering edited pixels preserves inherited capture data and the original timeline position', async () => {
  const capturedAt = new Date('2020-05-10T09:30:00Z');
  const inherited = {
    ...normalizePhotoExif({ Model: 'X-Pro3', DateTimeOriginal: '2020:05:10 09:30:00' }),
    captureMetadataInherited: true,
  };
  let written: Record<string, unknown> = {};
  let time: unknown;
  const tx = {
    eaglePhotoMetadata: {
      findFirst: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, {
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          assetId: 'copy',
          assetRevision: 2,
        });
        return inherited;
      },
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        written = create;
      },
    },
    eagleAsset: {
      updateMany: async ({ data }: { data: { chronologicalAt: unknown } }) => {
        time = data.chronologicalAt;
      },
    },
  };
  await persistPhotoAnalysis(
    tx as never,
    {
      id: 'copy',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      chronologicalAt: capturedAt,
      libraryAddedAt: new Date(),
    } as never,
    { ...normalizePhotoExif({}), sharpnessScore: 8, perceptualHash: 'new-hash' },
    2,
  );
  assert.equal(written.cameraModel, 'X-Pro3');
  assert.ok(written.capturedAt instanceof Date);
  assert.equal(written.capturedAt.toISOString(), capturedAt.toISOString());
  assert.equal(written.sharpnessScore, 8);
  assert.equal(written.perceptualHash, 'new-hash');
  assert.equal(written.captureMetadataInherited, true);
  assert.ok(time instanceof Date);
  assert.equal(time.toISOString(), capturedAt.toISOString());
});

test('optional metadata failure preserves a date already established during import', async () => {
  const importedCapture = new Date('2020-05-13T05:17:40Z');
  let result: Date | undefined;
  const tx = {
    eaglePhotoMetadata: {
      findFirst: () => Promise.resolve(null),
      upsert: () => Promise.resolve({}),
    },
    eagleAsset: {
      updateMany: ({ data }: { data: { chronologicalAt: Date } }) => {
        result = data.chronologicalAt;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  await persistPhotoAnalysis(
    tx as never,
    {
      id: 'asset',
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      chronologicalAt: importedCapture,
      libraryAddedAt: new Date('2026-10-23T00:00:00Z'),
    },
    { ...normalizePhotoExif({}), sharpnessScore: 1, perceptualHash: 'hash' },
    0,
  );
  assert.equal(result?.toISOString(), importedCapture.toISOString());
});

test('pixel-only analysis retains existing EXIF and original dimensions/date', async () => {
  let update: Record<string, unknown> = {};
  const capturedAt = new Date('2001-02-03T04:05:06Z');
  const tx = {
    eaglePhotoMetadata: {
      findFirst: async () => ({...normalizePhotoExif({Model:'Camera', DateTimeOriginal:'2001:02:03 04:05:06'}), captureMetadataInherited:false}),
      upsert: async (args: {update: Record<string, unknown>}) => {update=args.update;},
    },
    eagleAsset: {updateMany: async () => ({count:1})},
  };
  await persistPhotoAnalysis(tx as never,{id:'a',ownerId:'o',libraryMode:'PHOTO',chronologicalAt:capturedAt,libraryAddedAt:new Date()}, {sharpnessScore:1,perceptualHash:'0011223344556677'},1);
  assert.equal(Object.hasOwn(update,'cameraModel'),false);
  assert.equal(Object.hasOwn(update,'capturedAt'),false);
  assert.equal(update.sharpnessScore,1);
});
