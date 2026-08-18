import assert from 'node:assert/strict';
import test from 'node:test';
import { selectImageJobSource } from './image-job-source';

const asset = {
  originalObjectKey: 'users/owner-1/assets/asset-1/original.jpg',
  mimeType: 'image/jpeg',
  mediaRevision: 3,
  renditions: [
    {
      kind: 'THUMBNAIL' as const,
      revision: 3,
      status: 'READY' as const,
      storageKey: 'users/owner-1/assets/asset-1/renditions/3/thumbnail.webp',
      mimeType: 'image/webp',
    },
  ],
};

test('palette extraction reads the current ready thumbnail instead of the original', () => {
  assert.deepEqual(selectImageJobSource(asset, 'EXTRACT_COLOR_PALETTE'), {
    storageKey: asset.renditions[0]!.storageKey,
    mimeType: 'image/webp',
    verifiesOriginalHash: false,
  });
});

test('rendition and pyramid work retain the original source', () => {
  for (const kind of ['GENERATE_RENDITIONS', 'GENERATE_IMAGE_PYRAMID'] as const) {
    assert.deepEqual(selectImageJobSource(asset, kind), {
      storageKey: asset.originalObjectKey,
      mimeType: 'image/jpeg',
      verifiesOriginalHash: true,
    });
  }
});

test('embedding reads the current ready preview instead of the original', () => {
  const source = selectImageJobSource(
    {
      originalObjectKey: 'users/owner/assets/asset/original.heic',
      mimeType: 'image/heic',
      mediaRevision: 3,
      renditions: [
        {
          kind: 'PREVIEW',
          revision: 3,
          status: 'READY',
          storageKey: 'users/owner/assets/asset/renditions/3/preview-default.webp',
          mimeType: 'image/webp',
        },
      ],
    },
    'GENERATE_EMBEDDING',
  );

  assert.deepEqual(source, {
    storageKey: 'users/owner/assets/asset/renditions/3/preview-default.webp',
    mimeType: 'image/webp',
    verifiesOriginalHash: false,
  });
});

test('palette extraction fails closed when its dependent thumbnail is unavailable', () => {
  assert.throws(
    () => selectImageJobSource({ ...asset, renditions: [] }, 'EXTRACT_COLOR_PALETTE'),
    /READY_THUMBNAIL_MISSING/,
  );
});
