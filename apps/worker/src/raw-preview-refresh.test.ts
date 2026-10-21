import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawPreviewRefreshJobs, RAW_PREVIEW_PROCESSOR_VERSION } from './raw-preview-refresh';
const manifest = [
  { assetId: '11111111-1111-4111-8111-111111111111', sha256: 'a'.repeat(64), mediaRevision: 2 },
];
const asset = {
  id: manifest[0]!.assetId,
  ownerId: 'owner',
  libraryMode: 'PHOTO',
  mimeType: 'image/x-fuji-raf',
  sha256: 'a'.repeat(64),
  mediaRevision: 2,
  deletedAt: null,
  photoMetadata: { captureMetadataInherited: false },
};
test('RAW refresh freezes owner and media revision in idempotent existing rendition jobs', () => {
  const jobs = buildRawPreviewRefreshJobs(manifest, [asset] as never);
  assert.deepEqual(jobs, [
    {
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      assetId: asset.id,
      assetRevision: 2,
      kind: 'GENERATE_RENDITIONS',
      lane: 'INTERACTIVE',
      processorVersion: RAW_PREVIEW_PROCESSOR_VERSION,
    },
  ]);
  assert.deepEqual(buildRawPreviewRefreshJobs(manifest, [asset] as never), jobs);
});
test('RAW refresh rejects other modes, non-RAW, inherited edits and changed originals', () => {
  for (const invalid of [
    { ...asset, libraryMode: 'MATERIAL' },
    { ...asset, mimeType: 'image/jpeg' },
    { ...asset, sha256: 'b'.repeat(64) },
    { ...asset, mediaRevision: 3 },
    { ...asset, photoMetadata: { captureMetadataInherited: true } },
  ])
    assert.throws(() => buildRawPreviewRefreshJobs(manifest, [invalid] as never));
});
