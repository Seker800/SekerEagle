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
test('rejects pixel budgets and missing personal LUTs rather than silently changing the edit', async () => {
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
