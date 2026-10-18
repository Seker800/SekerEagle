import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizePhotoExif, analyzePhotoPixels } from './photo-analysis';

test('normalizes bounded photography metadata without inventing a timezone', () => {
  const value = normalizePhotoExif({ DateTimeOriginal: '2024:03:01 12:30:00', Make: 'Camera', Model: 'Model', LensModel: 'Prime', FNumber: 2.8, ExposureTime: 1/125, ISO: 200, latitude: 0, longitude: 0 });
  assert.equal(value.capturedAt?.toISOString(), '2024-03-01T12:30:00.000Z');
  assert.equal(value.captureTimeZoneKnown, false);
  assert.equal(value.latitude, 0);
  assert.equal(value.cameraModel, 'Model');
  assert.equal(normalizePhotoExif({latitude: 100, longitude: Infinity}).latitude, null);
});
test('explicit EXIF offsets are retained and invalid dates are ignored', () => {
  assert.equal(normalizePhotoExif({ DateTimeOriginal: '2024:03:01 12:30:00', OffsetTimeOriginal: '+08:00' }).capturedAt?.toISOString(), '2024-03-01T04:30:00.000Z');
  assert.equal(normalizePhotoExif({DateTimeOriginal: '2024:02:31 00:00:00'}).capturedAt, null);
});
test('pixel analysis is deterministic and a sharp edge has more detail than a flat image', async () => {
  const flat = sharp({ create: { width: 128, height: 128, channels: 3, background: '#808080' } });
  const data = Buffer.alloc(128*128*3);
  for(let y=0;y<128;y++) for(let x=0;x<128;x++) data.fill((x%8<4) ? 255 : 0, (y*128+x)*3, (y*128+x+1)*3);
  const edge=sharp(data,{raw:{width:128,height:128,channels:3}});
  const a = await analyzePhotoPixels(flat), b = await analyzePhotoPixels(edge);
  assert.match(a.perceptualHash, /^[0-9a-f]{16}$/);
  assert.ok(b.sharpnessScore > a.sharpnessScore);
});
