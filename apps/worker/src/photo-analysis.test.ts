import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizePhotoExif, analyzePhotoPixels } from './photo-analysis';

test('normalizes bounded photography metadata without inventing a timezone', () => {
  const value = normalizePhotoExif({
    DateTimeOriginal: '2024:03:01 12:30:00',
    Make: 'Camera',
    Model: 'Model',
    LensModel: 'Prime',
    FNumber: 2.8,
    ExposureTime: 1 / 125,
    ISO: 200,
    latitude: 0,
    longitude: 0,
  });
  assert.equal(value.capturedAt?.toISOString(), '2024-03-01T12:30:00.000Z');
  assert.equal(value.captureTimeZoneKnown, false);
  assert.equal(value.latitude, 0);
  assert.equal(value.cameraModel, 'Model');
  assert.equal(normalizePhotoExif({ latitude: 100, longitude: Infinity }).latitude, null);
});
test('explicit EXIF offsets are retained and invalid dates are ignored', () => {
  assert.equal(
    normalizePhotoExif({
      DateTimeOriginal: '2024:03:01 12:30:00',
      OffsetTimeOriginal: '+08:00',
    }).capturedAt?.toISOString(),
    '2024-03-01T04:30:00.000Z',
  );
  assert.equal(normalizePhotoExif({ DateTimeOriginal: '2024:02:31 00:00:00' }).capturedAt, null);
});
test('pixel analysis is deterministic and a sharp edge has more detail than a flat image', async () => {
  const flat = sharp({ create: { width: 128, height: 128, channels: 3, background: '#808080' } });
  const data = Buffer.alloc(128 * 128 * 3);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++)
      data.fill(x % 8 < 4 ? 255 : 0, (y * 128 + x) * 3, (y * 128 + x + 1) * 3);
  const edge = sharp(data, { raw: { width: 128, height: 128, channels: 3 } });
  const a = await analyzePhotoPixels(flat),
    b = await analyzePhotoPixels(edge);
  assert.match(a.perceptualHash, /^[0-9a-f]{16}$/);
  assert.ok(b.sharpnessScore > a.sharpnessScore);
});

test('reads real TIFF EXIF produced by an encoder', async () => {
  const { readPhotoExif } = await import('./photo-analysis');
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#777' } })
    .withExif({
      IFD0: { Make: 'Test Camera', Model: 'Test Model' },
      IFD2: { DateTimeOriginal: '2024:03:01 12:30:00', LensModel: 'Test Lens' },
    })
    .jpeg()
    .toBuffer();
  const metadata = await sharp(bytes).metadata();
  const result = await readPhotoExif(metadata.exif);
  assert.equal(result.cameraModel, 'Test Model');
  assert.equal(result.capturedAt?.toISOString(), '2024-03-01T12:30:00.000Z');
});

// The original container, rather than its metadata-poor decoded TIFF, is authoritative.
test('reads RAF and IFD0 DNG capture fields from the original without losing GPS signs', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readPhotoExif } = await import('./photo-analysis');
  const dir = await mkdtemp(join(tmpdir(), 'photo-exif-test-'));
  const previous = process.env.EXIFTOOL_PATH;
  const tool = join(dir, 'exiftool');
  const original = join(dir, 'original.raf');
  await writeFile(original, 'synthetic-container');
  await writeFile(tool, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify([{Make:'FUJIFILM',Model:'X-E5',LensModel:'Prime',DateTimeOriginal:'2026:10:01 12:30:00',FocalLength:35,FNumber:2,ExposureTime:0.008,ISO:400,GPSLatitude:30,GPSLongitude:120,GPSLatitudeRef:'S',GPSLongitudeRef:'W'}]));`, {mode:0o700});
  process.env.EXIFTOOL_PATH = tool;
  try {
    const result = await readPhotoExif(undefined, original);
    assert.equal(result.cameraModel, 'X-E5');
    assert.equal(result.lensModel, 'Prime');
    assert.equal(result.capturedLocal, '2026-10-01T12:30:00');
    assert.equal(result.exposureSeconds, 0.008);
    assert.equal(result.latitude, -30);
    assert.equal(result.longitude, -120);
    const partial = await sharp({create:{width:2,height:2,channels:3,background:'#333'}}).withExif({IFD0:{Model:'Decoded TIFF'}}).tiff().toBuffer();
    assert.equal((await readPhotoExif((await sharp(partial).metadata()).exif, original)).cameraModel,'X-E5');
    process.env.EXIFTOOL_PATH = join(dir,'missing');
    await assert.rejects(readPhotoExif(undefined,original), {code:'ENOENT'});
  } finally {
    if(previous===undefined)delete process.env.EXIFTOOL_PATH;else process.env.EXIFTOOL_PATH=previous;
    await rm(dir,{recursive:true,force:true});
  }
});
