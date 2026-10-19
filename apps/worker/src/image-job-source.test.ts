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

test('AI noun tagging reads the bounded preview instead of the original', () => {
  const sourceAsset = {
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
  };

  assert.deepEqual(selectImageJobSource(sourceAsset, 'GENERATE_AI_TAGS'), {
    storageKey: sourceAsset.renditions[0]!.storageKey,
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

test('image AI jobs skip video motion previews', () => {
  const source = selectImageJobSource(
    {
      originalObjectKey: 'original.jpg',
      mimeType: 'image/jpeg',
      mediaRevision: 1,
      renditions: [
        {
          kind: 'PREVIEW',
          revision: 1,
          status: 'READY',
          storageKey: 'motion.mp4',
          mimeType: 'video/mp4',
        },
        {
          kind: 'PREVIEW',
          revision: 1,
          status: 'READY',
          storageKey: 'still.webp',
          mimeType: 'image/webp',
        },
      ],
    },
    'GENERATE_EMBEDDING',
  );
  assert.equal(source.storageKey, 'still.webp');
});

test('analysis never loads the large RAW edit copy, even when it precedes the browsing preview', () => {
  const edit = {
    kind: 'PREVIEW',
    variant: 'edit',
    revision: 3,
    status: 'READY',
    storageKey: 'edit.webp',
    mimeType: 'image/webp',
  };
  const preview = { ...edit, variant: 'default', storageKey: 'preview.webp' };
  for (const kind of ['GENERATE_AI_TAGS', 'GENERATE_EMBEDDING', 'ANALYZE_PHOTO_FACES'] as const) {
    assert.equal(
      selectImageJobSource({ ...asset, renditions: [edit, preview] }, kind).storageKey,
      'preview.webp',
    );
    assert.throws(
      () => selectImageJobSource({ ...asset, renditions: [edit] }, kind),
      /READY_PREVIEW_MISSING/,
    );
  }
});
