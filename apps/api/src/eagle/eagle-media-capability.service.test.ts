import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';

const MEDIA_MAX_BYTES = 250 * 1024 * 1024;
const service = new EagleMediaCapabilityService();

test('publishes frozen camera capabilities with separate image and video budgets', () => {
  const capabilities = service.getCapabilities();
  assert.equal(capabilities.version, 1);
  assert.ok(Object.isFrozen(capabilities));
  for (const extension of ['.jpg', '.tiff', '.dng', '.nef', '.cr3'])
    assert.ok(capabilities.images.extensions.includes(extension));
  for (const extension of ['.mp4', '.mov', '.mts', '.mxf'])
    assert.ok(capabilities.videos.extensions.includes(extension));
  assert.equal(capabilities.images.maxBytes, 250 * 1024 * 1024);
  assert.equal(capabilities.videos.maxBytes, 2 * 1024 * 1024 * 1024);
  assert.equal(capabilities.images.maxPixels, MAX_EAGLE_IMAGE_INPUT_PIXELS);
});

test('accepts the supported media matrix including AVIF', () => {
  assert.deepEqual(
    service.assertUploadAllowed({ fileName: 'reference.AVIF', mimeType: 'image/avif', size: 2048 }),
    { mediaType: 'image', mimeType: 'image/avif' },
  );
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
    { fileName: 'movie.mkv', mimeType: 'video/x-matroska', size: 1 },
    { fileName: 'large.png', mimeType: 'image/png', size: MEDIA_MAX_BYTES + 1 },
    { fileName: 'large.mp4', mimeType: 'video/mp4', size: 2 * 1024 * 1024 * 1024 + 1 },
    { fileName: 'empty.png', mimeType: 'image/png', size: 0 },
    { fileName: 'fraction.png', mimeType: 'image/png', size: 1.5 },
  ];
  for (const candidate of rejected) {
    assert.throws(() => service.assertUploadAllowed(candidate), BadRequestException);
  }
});

test('accepts browser-generic camera RAW, TIFF and camera video MIME declarations', () => {
  for (const [fileName, mimeType] of [
    ['capture.dng', 'application/octet-stream'],
    ['capture.NEF', ''],
    ['clip.MOV', 'video/quicktime'],
    ['clip.mts', 'video/mp2t'],
    ['clip.mxf', 'application/mxf'],
    ['scan.tif', 'image/tiff'],
  ]) {
    const result = service.assertUploadAllowed({
      fileName: fileName!,
      mimeType: mimeType!,
      size: 2048,
    });
    assert.ok(result.mimeType !== 'application/octet-stream');
  }
  assert.equal(
    service.assertUploadAllowed({
      fileName: 'clip.mov',
      mimeType: 'video/quicktime',
      size: 512 * 1024 * 1024,
    }).mediaType,
    'video',
  );
  assert.throws(
    () =>
      service.assertUploadAllowed({ fileName: 'capture.dng', mimeType: 'video/mp4', size: 2048 }),
    BadRequestException,
  );
});
