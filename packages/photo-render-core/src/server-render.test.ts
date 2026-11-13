import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { renderServerPhoto } from './server-render';
test('renders original resolution rather than the phone preview, including crop and watermark', async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 4, background: '#4477aa' },
  })
    .png()
    .toBuffer();
  const output = await renderServerPhoto(
    source,
    { ...DEFAULT_PHOTO_EDITS, cropRatio: '1:1', watermark: 'photo-strip' },
    { camera: 'Test camera' },
  );
  const info = await sharp(output).metadata();
  assert.equal(info.width, 800);
  assert.ok(info.height! > 800);
});
test('renders a straightened, inset crop without empty corners at server resolution', async () => {
  const source = await sharp({
    create: { width: 400, height: 200, channels: 4, background: '#4477aa' },
  })
    .png()
    .toBuffer();
  const output = await renderServerPhoto(source, { ...DEFAULT_PHOTO_EDITS, straighten: 10 }, {});
  const info = await sharp(output).metadata();
  assert.ok(info.width! >= 296 && info.width! <= 305, `width ${info.width}`);
  assert.ok(info.height! >= 145 && info.height! <= 155, `height ${info.height}`);
  const { channels } = await sharp(output).stats();
  assert.equal(channels[3]!.min, 255);
});
test('mirrors a straightened vignette consistently instead of moving its center', async () => {
  const source = await sharp({
    create: { width: 400, height: 200, channels: 4, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  const edits = { ...DEFAULT_PHOTO_EDITS, straighten: 20, vignette: 100 };
  const normal = await renderServerPhoto(source, edits, {});
  const flipped = await renderServerPhoto(source, { ...edits, flip: true }, {});
  const [a, b] = await Promise.all([
    sharp(normal).flop().ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(flipped).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(a.info.width, b.info.width);
  assert.equal(a.info.height, b.info.height);
  let maxDifference = 0;
  for (let i = 0; i < a.data.length; i++)
    maxDifference = Math.max(maxDifference, Math.abs(a.data[i]! - b.data[i]!));
  assert.ok(maxDifference <= 1, `max channel difference ${maxDifference}`);
});
test('rejects missing personal LUTs rather than silently changing the edit', async () => {
  const source = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#fff' } })
    .png()
    .toBuffer();
  await assert.rejects(
    renderServerPhoto(source, { ...DEFAULT_PHOTO_EDITS, filter: 'lut:missing' }, {}),
    /LUT/,
  );
});

test('portable LUT encoding validates table shape, values and domains before allocating', async () => {
  const { writePortableLut, readPortableLut } = await import('./portable-lut');
  const input = {
    size: 2,
    data: new Float32Array(24).fill(0.5),
    domainMin: [0, 0, 0] as [number, number, number],
    domainMax: [1, 1, 1] as [number, number, number],
  };
  assert.deepEqual(readPortableLut(writePortableLut(input)), input);
  for (const value of [
    '{}',
    JSON.stringify({ size: 100000, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: 'AA==' }),
    writePortableLut({ ...input, data: new Float32Array(24).fill(Infinity) }),
    writePortableLut({ ...input, domainMax: [0, 1, 1] }),
  ])
    assert.throws(() => readPortableLut(value), /INVALID_LUT/);
});
