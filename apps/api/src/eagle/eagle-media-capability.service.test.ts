import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { MAX_EAGLE_IMAGE_INPUT_PIXELS } from './eagle-image-processing-policy';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';

const MEDIA_MAX_BYTES = 500_000_000;
const service = new EagleMediaCapabilityService();

test('publishes frozen camera capabilities with separate image and video budgets', () => {
  const capabilities = service.getCapabilities();
  assert.equal(capabilities.version, 1);
  assert.equal(capabilities.serverPhotoEditing, 1);
  assert.ok(Object.isFrozen(capabilities));
  assert.deepEqual(capabilities.images.extensions, [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.avif',
    '.heic',
    '.heif',
    '.tif',
    '.tiff',
    '.dng',
    '.cr2',
    '.cr3',
    '.crw',
    '.nef',
    '.nrw',
    '.arw',
    '.sr2',
    '.raf',
    '.orf',
    '.rw2',
    '.rwl',
    '.pef',
    '.srw',
    '.kdc',
    '.raw',
  ]);
  assert.deepEqual(capabilities.videos.extensions, [
    '.mp4',
    '.m4v',
    '.mov',
    '.mts',
    '.m2ts',
    '.avi',
    '.mxf',
    '.mpg',
    '.mpeg',
  ]);
  assert.deepEqual(capabilities.images.mimeTypes, [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/tiff',
    'image/x-adobe-dng',
    'image/x-canon-cr2',
    'image/x-canon-cr3',
    'image/x-canon-crw',
    'image/x-nikon-nef',
    'image/x-nikon-nrw',
    'image/x-sony-arw',
    'image/x-sony-sr2',
    'image/x-fuji-raf',
    'image/x-olympus-orf',
    'image/x-panasonic-rw2',
    'image/x-leica-rwl',
    'image/x-pentax-pef',
    'image/x-samsung-srw',
    'image/x-kodak-kdc',
    'image/x-raw',
  ]);
  assert.deepEqual(capabilities.videos.mimeTypes, [
    'video/mp4',
    'video/quicktime',
    'video/mp2t',
    'video/x-msvideo',
    'application/mxf',
    'video/mpeg',
  ]);
  assert.deepEqual(capabilities.images.formats, [
    'arw',
    'avif',
    'cr2',
    'cr3',
    'crw',
    'dng',
    'gif',
    'heif',
    'jpeg',
    'kdc',
    'nef',
    'nrw',
    'orf',
    'pef',
    'png',
    'raf',
    'raw',
    'rw2',
    'rwl',
    'sr2',
    'srw',
    'tiff',
    'webp',
  ]);
  assert.deepEqual(capabilities.videos.formats, ['avi', 'mov', 'mp4', 'mpg', 'mts', 'mxf']);
  assert.equal(capabilities.images.maxBytes, 500_000_000);
  assert.equal(capabilities.videos.maxBytes, 5_000_000_000);
  assert.equal(capabilities.images.maxPixels, MAX_EAGLE_IMAGE_INPUT_PIXELS);
  assert.equal(capabilities.images.maxRawPixels, 120_000_000);
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
    { fileName: 'large.mp4', mimeType: 'video/mp4', size: 5_000_000_000 + 1 },
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

test('accepts exact decimal file limits and the NAS large-file samples', () => {
  for (const fileName of ['photo.jpg', 'capture.raf', 'scan.tif']) {
    assert.equal(
      service.assertUploadAllowed({ fileName, mimeType: '', size: 500_000_000 }).mediaType,
      'image',
    );
    assert.throws(
      () => service.assertUploadAllowed({ fileName, mimeType: '', size: 500_000_001 }),
      /500 MB/,
    );
  }
  assert.equal(
    service.assertUploadAllowed({
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      size: 5_000_000_000,
    }).mediaType,
    'video',
  );
  assert.throws(
    () =>
      service.assertUploadAllowed({
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        size: 5_000_000_001,
      }),
    /5 GB/,
  );
  for (const size of [295238048, 441007614])
    assert.equal(
      service.assertUploadAllowed({ fileName: 'scan.tif', mimeType: 'image/tiff', size }).mediaType,
      'image',
    );
  for (const size of [2365794893, 4010397244])
    assert.equal(
      service.assertUploadAllowed({ fileName: 'clip.mp4', mimeType: 'video/mp4', size }).mediaType,
      'video',
    );
});
