import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';

const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const service = new EagleMediaCapabilityService();

test('publishes the frozen P0 media capability matrix', () => {
  assert.deepEqual(service.getCapabilities(), {
    version: 1,
    images: {
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
      extensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif'],
      maxBytes: MEDIA_MAX_BYTES,
      maxPixels: MAX_EAGLE_IMAGE_INPUT_PIXELS,
    },
    videos: {
      mimeTypes: ['video/mp4'],
      extensions: ['.mp4'],
      maxBytes: MEDIA_MAX_BYTES,
      maxDurationMs: null,
    },
  });
});

test('accepts exactly the original supported media matrix', () => {
  assert.deepEqual(
    service.assertUploadAllowed({ fileName: 'reference.WEBP', mimeType: 'image/webp', size: 2048 }),
    { mediaType: 'image', mimeType: 'image/webp' },
  );
  assert.deepEqual(
    service.assertUploadAllowed({ fileName: 'iphone.HEIC', mimeType: 'image/heic', size: 2048 }),
    { mediaType: 'image', mimeType: 'image/heic' },
  );
  assert.deepEqual(
    service.assertUploadAllowed({ fileName: 'clip.mp4', mimeType: 'video/mp4', size: 2048 }),
    { mediaType: 'video', mimeType: 'video/mp4' },
  );
});

test('rejects mismatches, unsupported media, oversized files, and unsafe sizes', () => {
  const rejected = [
    { fileName: 'not-a-video.jpg', mimeType: 'video/mp4', size: 2048 },
    { fileName: 'vector.svg', mimeType: 'image/svg+xml', size: 1 },
    { fileName: 'document.pdf', mimeType: 'application/pdf', size: 1 },
    { fileName: 'movie.mov', mimeType: 'video/quicktime', size: 1 },
    { fileName: 'large.png', mimeType: 'image/png', size: MEDIA_MAX_BYTES + 1 },
    { fileName: 'large.mp4', mimeType: 'video/mp4', size: MEDIA_MAX_BYTES + 1 },
    { fileName: 'empty.png', mimeType: 'image/png', size: 0 },
    { fileName: 'fraction.png', mimeType: 'image/png', size: 1.5 },
  ];
  for (const candidate of rejected) {
    assert.throws(() => service.assertUploadAllowed(candidate), BadRequestException);
  }
});
