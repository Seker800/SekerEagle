import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraMediaFormat,
  normalizeCameraMimeType,
  CAMERA_MAX_VIDEO_BYTES,
} from './media-formats';

test('camera catalog recognizes raw families, TIFF and camera video containers', () => {
  for (const extension of ['dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2', 'pef', 'srw']) {
    assert.equal(cameraMediaFormat(`original.${extension}`)?.kind, 'raw');
  }
  for (const extension of ['mp4', 'mov', 'm4v', 'mts', 'm2ts', 'avi', 'mxf', 'mpg']) {
    assert.equal(cameraMediaFormat(`clip.${extension}`)?.kind, 'video');
  }
  assert.equal(cameraMediaFormat('image.TIFF')?.mimeType, 'image/tiff');
  assert.equal(cameraMediaFormat('script.exe'), null);
  assert.ok(CAMERA_MAX_VIDEO_BYTES > 100 * 1024 * 1024);
});
test('generic browser MIME is normalized by catalog without accepting conflicting declarations', () => {
  assert.equal(normalizeCameraMimeType('image.DNG', ''), 'image/x-adobe-dng');
  assert.equal(
    normalizeCameraMimeType('image.NEF', 'application/octet-stream'),
    'image/x-nikon-nef',
  );
  assert.equal(normalizeCameraMimeType('video.MTS', 'video/mp2t'), 'video/mp2t');
  assert.equal(normalizeCameraMimeType('image.dng', 'image/jpeg'), null);
  assert.equal(normalizeCameraMimeType('script.exe', 'application/octet-stream'), null);
});

test('accepts camera MIME aliases while retaining content validation and rejecting unrelated images', () => {
  for (const [file, mime, expected] of [
    ['photo.dng', 'image/tiff', 'image/x-adobe-dng'],
    ['photo.DNG', 'image/x-dng', 'image/x-adobe-dng'],
    ['photo.RAF', 'image/x-fujifilm-raf', 'image/x-fuji-raf'],
    ['photo.NEF', 'image/x-nikon-raw', 'image/x-nikon-nef'],
  ])
    assert.equal(normalizeCameraMimeType(file!, mime!), expected);
  assert.equal(normalizeCameraMimeType('photo.raf', 'image/jpeg'), null);
  assert.equal(normalizeCameraMimeType('photo.nef', 'image/png'), null);
});
