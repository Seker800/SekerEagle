import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { join } from 'node:path';
import { assertSafeHeifInfo, decodeProcessableImage } from './image-media';

test('HEIF decoder rejects multi-image decompression bombs before pixel decoding', () => {
  assert.doesNotThrow(() => assertSafeHeifInfo('image: 4000x3000 (id=1), primary'));
  assert.throws(
    () => assertSafeHeifInfo('image: 8000x5000 (id=1), primary\nimage: 4000x3000 (id=2)'),
    /IMAGE_PIXEL_LIMIT_EXCEEDED/,
  );
  assert.throws(() => assertSafeHeifInfo('metadata only'), /IMAGE_PIXEL_LIMIT_EXCEEDED/);
});

test('ordinary image bytes bypass the external HEIF decoder', async () => {
  const input = Buffer.from('ordinary-image');
  assert.equal(await decodeProcessableImage(input, 'image/png', 'original.png'), input);
});

test('image processing does not concatenate the complete source object in memory', async () => {
  const source = await readFile(join(__dirname, 'image-media.ts'), 'utf8');

  assert.doesNotMatch(source, /Buffer\.concat\s*\(/);
  assert.doesNotMatch(source, /transformToByteArray\s*\(/);
  assert.match(source, /pipeline\s*\(/);
});

test('HEIF missing decoder fails closed instead of invoking an uninspected ffmpeg fallback', async () => {
  const previous = process.env.HEIF_INFO_PATH;
  process.env.HEIF_INFO_PATH = '/nonexistent/sekereagle-test-heif-info';
  try {
    await assert.rejects(
      decodeProcessableImage(Buffer.from('synthetic-heif'), 'image/heic', 'original.heic'),
      { code: 'ENOENT' },
    );
  } finally {
    if (previous === undefined) delete process.env.HEIF_INFO_PATH;
    else process.env.HEIF_INFO_PATH = previous;
  }
});
