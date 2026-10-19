import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readAppleLivePhotoIdentifier,
  readMotionPhotoRange,
  normalizeLivePhotoIdentifier,
} from './index';
const id = 'C94808DC-251E-40B0-B2A3-85B23134C526';
function maker(little = false) {
  const bytes = Buffer.alloc(72);
  bytes.write('Apple iOS\0', 0, 'ascii');
  bytes.write(little ? 'II' : 'MM', 12, 'ascii');
  const u16 = (v: number, p: number) =>
    little ? bytes.writeUInt16LE(v, p) : bytes.writeUInt16BE(v, p);
  const u32 = (v: number, p: number) =>
    little ? bytes.writeUInt32LE(v, p) : bytes.writeUInt32BE(v, p);
  u16(1, 14);
  u16(17, 16);
  u16(2, 18);
  u32(37, 20);
  u32(32, 24);
  bytes.write(id, 32, 'ascii');
  return bytes;
}
test('Apple identifier comes only from the bounded ContentIdentifier MakerNote entry', () => {
  for (const little of [false, true])
    assert.equal(readAppleLivePhotoIdentifier(maker(little)), id.toLowerCase());
  assert.equal(normalizeLivePhotoIdentifier('../../bad'), null);
  assert.equal(readAppleLivePhotoIdentifier(Buffer.from(id)), null);
  const invalid = maker();
  invalid.writeUInt32BE(9999999, 24);
  assert.equal(readAppleLivePhotoIdentifier(invalid), null);
  assert.equal(readAppleLivePhotoIdentifier(maker().subarray(0, 18)), null);
});
test('Motion Photo ranges respect metadata length, padding, file bounds and budgets', () => {
  const modern =
    '<x:xmpmeta GCamera:MotionPhoto="1"><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="100" Item:Padding="4"/></x:xmpmeta>';
  assert.deepEqual(readMotionPhotoRange(modern, 1000), { start: 896, length: 100 });
  assert.deepEqual(
    readMotionPhotoRange('<x GCamera:MicroVideo="1" GCamera:MicroVideoOffset="200"/>', 1000),
    { start: 800, length: 200 },
  );
  for (const xmp of [
    '',
    modern.replace('100', '10000'),
    modern.replace('100', '999999999'),
    modern.replace('video/mp4', 'text/plain'),
  ])
    assert.equal(readMotionPhotoRange(xmp, 1000), null);
});
