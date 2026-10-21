import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePhotoMetadataRefreshManifest,
  assertPhotoMetadataRefreshCandidates,
} from './photo-metadata-refresh';
const item = {
  assetId: '11111111-1111-4111-8111-111111111111',
  sha256: 'a'.repeat(64),
  mediaRevision: 1,
};
test('metadata refresh accepts only a bounded exact manifest without owner input', () => {
  assert.deepEqual(validatePhotoMetadataRefreshManifest([item]), [item]);
  for (const invalid of [
    null,
    undefined,
    {},
    [null],
    [1],
    [[]],
    [{ ...item, mediaRevision: NaN }],
    [{ ...item, mediaRevision: 1.5 }],
    [{ ...item, assetId: 1 }],
    [{ ...item, sha256: 1 }],
    [],
    Array(101).fill(item),
    [item, item],
    [{ ...item, ownerId: 'other' }],
    [{ ...item, sha256: 'bad' }],
    [{ ...item, mediaRevision: -1 }],
    [{ ...item, assetId: '../bad' }],
  ])
    assert.throws(() => validatePhotoMetadataRefreshManifest(invalid));
});
test('metadata refresh fails closed for mixed owners, modes, changed originals or inherited edits', () => {
  const asset = {
    id: item.assetId,
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    sha256: item.sha256,
    mediaRevision: 1,
    deletedAt: null,
    photoMetadata: { captureMetadataInherited: false },
  };
  assert.doesNotThrow(() => assertPhotoMetadataRefreshCandidates([item], [asset] as never));
  for (const changed of [
    { ...asset, libraryMode: 'MATERIAL' },
    { ...asset, sha256: 'b'.repeat(64) },
    { ...asset, mediaRevision: 2 },
    { ...asset, deletedAt: new Date() },
    { ...asset, photoMetadata: { captureMetadataInherited: true } },
  ])
    assert.throws(() => assertPhotoMetadataRefreshCandidates([item], [changed] as never));
  const second = { ...item, assetId: '22222222-2222-4222-8222-222222222222' };
  assert.throws(() =>
    assertPhotoMetadataRefreshCandidates([item, second], [
      asset,
      { ...asset, id: second.assetId, ownerId: 'other' },
    ] as never),
  );
  assert.throws(() => assertPhotoMetadataRefreshCandidates([item], []));
});
