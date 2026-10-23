import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedPhotoPolicy } from './cached-photo-policy';
test('unprobed original dimensions come from original tags, with camera orientation applied', () => {
  assert.deepEqual(
    cachedPhotoPolicy(
      'image/jpeg',
      {},
      { ImageWidth: 8192, ImageHeight: 6144, Orientation: 6 },
      { width: 1280, height: 1707 },
    ),
    { width: 6144, height: 8192, deferRawEditing: false },
  );
  assert.deepEqual(
    cachedPhotoPolicy(
      'image/x-fuji-raf',
      { width: 6000, height: 4000 },
      {},
      { width: 1920, height: 1280 },
    ),
    { width: 6000, height: 4000, deferRawEditing: true },
  );
});
test('cache dimensions never masquerade as original resolution', () => {
  for (const tags of [
    {},
    { ImageWidth: 0, ImageHeight: 100 },
    { ImageWidth: 4000, ImageHeight: 6000 },
  ])
    assert.throws(() => cachedPhotoPolicy('image/jpeg', {}, tags, { width: 1920, height: 1280 }));
  assert.throws(() =>
    cachedPhotoPolicy(
      'video/mp4',
      { width: 1920, height: 1280 },
      {},
      { width: 1920, height: 1280 },
    ),
  );
});

test('deferred original-source details never block a usable imported cover', async () => {
  const { taskBlocksAssetReady, terminalAssetFailure } = await import('./processing-policy');
  assert.equal(taskBlocksAssetReady('GENERATE_RENDITIONS', 'photo-source-details-v1'), false);
  assert.deepEqual(
    terminalAssetFailure('GENERATE_RENDITIONS', 'photo-source-details-v1', 'failure'),
    { mediaErrorCode: 'PHOTO_SOURCE_DETAILS_FAILED' },
  );
});
