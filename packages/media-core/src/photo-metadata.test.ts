import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPhotoMetadataTags } from './photo-metadata';
import { assertSafeHeifInfo, parseHeifInfo } from './heif';

test('original tag reader bounds its command, signs GPS coordinates and rejects malformed responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'media-tag-test-'));
  const tool = join(directory, 'tool'),
    old = process.env.EXIFTOOL_PATH;
  process.env.EXIFTOOL_PATH = tool;
  const script = async (output: string, exit = 0) =>
    writeFile(
      tool,
      `#!${process.execPath}\nif(process.env.S3_SECRET_ACCESS_KEY)process.exit(99);process.stdout.write(${JSON.stringify(output)});process.exit(${exit});`,
      { mode: 0o700 },
    );
  const secret = process.env.S3_SECRET_ACCESS_KEY;
  process.env.S3_SECRET_ACCESS_KEY = 'test-never-forwarded';
  try {
    await script(
      JSON.stringify([
        {
          Model: 'Camera',
          GPSLatitude: 30,
          GPSLongitude: 120,
          GPSLatitudeRef: 'N',
          GPSLongitudeRef: 'E',
          GPSAltitude: 10,
          GPSAltitudeRef: 1,
          Ignored: 'never-copy',
        },
      ]),
    );
    const tags = await readPhotoMetadataTags('./original');
    assert.equal(tags.latitude, 30);
    assert.equal(tags.longitude, 120);
    assert.equal(tags.GPSAltitude, -10);
    assert.equal(tags.Ignored, undefined);
    await script('[{}]');
    assert.deepEqual(await readPhotoMetadataTags('./original'), {});
    await script('[{"Error":"Unknown file format"}]', 1);
    assert.deepEqual(await readPhotoMetadataTags('./original'), {});
    for (const value of ['[]', 'null', '[null]', '[{} , {}]', 'invalid']) {
      await script(value);
      await assert.rejects(readPhotoMetadataTags('./original'));
    }
    await script('[{}]', 2);
    await assert.rejects(readPhotoMetadataTags('./original'));
    await script('[{}]', 1);
    await assert.rejects(readPhotoMetadataTags('./original'));
  } finally {
    if (old === undefined) delete process.env.EXIFTOOL_PATH;
    else process.env.EXIFTOOL_PATH = old;
    if (secret === undefined) delete process.env.S3_SECRET_ACCESS_KEY;
    else process.env.S3_SECRET_ACCESS_KEY = secret;
    await rm(directory, { recursive: true, force: true });
  }
});
test('aggregate HEIF pixel budgets reject zero, oversized and unrecognized image lists', () => {
  assert.doesNotThrow(() => assertSafeHeifInfo('image: 100x100 (id=1), primary'));
  for (const info of [
    'image: 0x100 (id=1)',
    'image: 100x0 (id=1)',
    'image: 12000x10000 (id=1)\nimage: 1x1 (id=2)',
    'image: 99999999999999999999x9000000000',
    'no images',
  ])
    assert.throws(() => assertSafeHeifInfo(info));
});

test('HEIF full-frame decoding stays inside an independent 64MP aggregate budget', () => {
  assert.doesNotThrow(() => assertSafeHeifInfo('image: 8000x8000, primary'));
  assert.throws(() => assertSafeHeifInfo('image: 8000x8000, primary\nimage: 1x1'));
  assert.throws(() => assertSafeHeifInfo('image: 12000x10000, primary'));
});

test('a single HEIF image needs no primary flag; ambiguous multi-image containers fail closed', () => {
  assert.deepEqual(parseHeifInfo('MIME type: image/heic\nimage: 12x8 (id=1)'), {
    width: 12,
    height: 8,
  });
  assert.deepEqual(parseHeifInfo('MIME type: image/heif\nimage: 6x4\nimage: 12x8, primary'), {
    width: 12,
    height: 8,
  });
  assert.throws(() => parseHeifInfo('MIME type: image/heic\nimage: 6x4\nimage: 12x8'), /primary/);
});
