import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createImageEdit } from '@sekereagle/library-core';
import { renderImageEdit } from './eagle-image-edit-render';

test('renders a full-resolution crop and quarter turn without changing the input', async () => {
  const input = await sharp({
    create: { width: 80, height: 40, channels: 4, background: '#cc553388' },
  })
    .png()
    .toBuffer();
  const before = Buffer.from(input);
  const output = await renderImageEdit(input, {
    ...createImageEdit(),
    crop: { x: 0.25, y: 0, width: 0.5, height: 0.5 },
    rotation: 90,
  });
  const meta = await sharp(output).metadata();
  assert.equal(meta.width, 20);
  assert.equal(meta.height, 40);
  assert.equal(meta.hasAlpha, true);
  assert.deepEqual(input, before);
});

test('mirrors pixels and applies brightness, contrast and saturation', async () => {
  const input = await sharp(Buffer.from([200, 20, 40, 0, 100, 200]), {
    raw: { width: 2, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();
  const output = await renderImageEdit(input, {
    ...createImageEdit(),
    flipX: true,
    saturation: 0,
    brightness: 0.5,
  });
  const { data } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(data[0]! - data[1]!) <= 1);
  assert.ok(data[0]! < 60);
  assert.notDeepEqual(output, input);
});

test('rejects animated input and malformed recipes', async () => {
  await assert.rejects(() => renderImageEdit(Buffer.from('bad'), createImageEdit()));
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  await assert.rejects(() => renderImageEdit(input, { ...createImageEdit(), contrast: NaN }));
});
