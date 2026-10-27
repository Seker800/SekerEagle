import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageWorkResponseLimit, imageWorkMemoryMiB } from './image-work-budget';
import { mediaMemoryMiB } from './media-resource-budget';
test('photo browsing uses compact bounded outputs while RAW detail and material motion keep large reservations', () => {
  const browse = { kind: 'GENERATE_RENDITIONS', mode: 'PHOTO', detailsOnly: false } as const;
  assert.equal(imageWorkResponseLimit(browse), 32 * 1024 ** 2);
  assert.equal(imageWorkMemoryMiB(browse), 128);
  assert.equal(imageWorkResponseLimit({ ...browse, detailsOnly: true }), 256 * 1024 ** 2);
  assert.equal(imageWorkMemoryMiB({ ...browse, detailsOnly: true }), 768);
  assert.equal(imageWorkMemoryMiB({ ...browse, mode: 'MATERIAL' }), 768);
  assert.equal(
    mediaMemoryMiB('REMOTE_MEDIA', {
      kind: 'GENERATE_RENDITIONS',
      libraryMode: 'PHOTO',
      processorVersion: 'rendition-v2',
    }),
    128,
  );
  assert.equal(
    mediaMemoryMiB('REMOTE_MEDIA', {
      kind: 'GENERATE_RENDITIONS',
      libraryMode: 'PHOTO',
      processorVersion: 'photo-source-details-v1',
    }),
    768,
  );
  assert.equal(imageWorkResponseLimit({ ...browse, kind: 'EXTRACT_COLOR_PALETTE' }), 2 * 1024 ** 2);
});

test('remote faces reserve only bounded transport while local inference keeps its decoder budget', () => {
  assert.equal(mediaMemoryMiB('REMOTE_MEDIA', { kind: 'ANALYZE_PHOTO_FACES' }), 64);
  assert.equal(mediaMemoryMiB('NAS', { kind: 'ANALYZE_PHOTO_FACES' }), 384);
});

test('initial material video and later playback both use streamed artifact reservations', () => {
  for (const processorVersion of ['camera-video-preview-v2', 'camera-video-playback-v1'])
    assert.equal(
      mediaMemoryMiB('REMOTE_MEDIA', {
        kind: 'GENERATE_RENDITIONS',
        libraryMode: 'MATERIAL',
        processorVersion,
      }),
      128,
    );
});
