import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { renderServerPhoto } from './server-render';
test('renders original resolution rather than the phone preview, including crop and watermark', async () => {
  const source = await sharp({ create: { width: 1200, height: 800, channels: 4, background: '#4477aa' } }).png().toBuffer();
  const output = await renderServerPhoto(source, { ...DEFAULT_PHOTO_EDITS, cropRatio: '1:1', watermark: 'photo-strip' }, { camera: 'Test camera' });
  const info = await sharp(output).metadata();
  assert.equal(info.width, 800);
  assert.ok(info.height! > 800);
});
test('rejects pixel budgets and missing personal LUTs rather than silently changing the edit', async () => {
  const source = await sharp({ create: { width: 64, height: 32, channels: 4, background: '#fff' } }).png().toBuffer();
  await assert.rejects(renderServerPhoto(source, { ...DEFAULT_PHOTO_EDITS, filter: 'lut:missing' }, {}), /LUT/);
});
