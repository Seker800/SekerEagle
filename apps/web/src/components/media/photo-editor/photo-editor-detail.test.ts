import { describe, expect, it } from 'vitest';
import { applyPhotoDetail, triangleBlur } from './photo-editor-detail';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';

function solid(width: number, height: number, value = 128) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([value, value, value, 255], i);
  return pixels;
}
describe('spatial photo controls', () => {
  it('preserves constant fields and the edge-extension rule even for one-pixel images', () => {
    expect(Array.from(triangleBlur(new Float32Array([64]), 1, 1, 8))).toEqual([64]);
    expect(
      applyPhotoDetail(solid(25, 15), 25, 15, {
        ...DEFAULT_PHOTO_EDITS,
        sharpen: 100,
        clarity: 100,
      }),
    ).toEqual(solid(25, 15));
  });
  it('sharpens an edge and uses a distinct wider neighborhood for clarity', () => {
    const width = 512,
      height = 4,
      pixels = solid(width, height, 96);
    for (let y = 0; y < height; y++)
      for (let x = width / 2; x < width; x++) pixels.set([160, 160, 160, 255], (y * width + x) * 4);
    const sharp = applyPhotoDetail(pixels, width, height, { ...DEFAULT_PHOTO_EDITS, sharpen: 100 });
    const clarity = applyPhotoDetail(pixels, width, height, {
      ...DEFAULT_PHOTO_EDITS,
      clarity: 100,
    });
    expect(sharp[(width / 2 - 1) * 4]).toBeLessThan(96);
    expect(sharp[(width / 2) * 4]).toBeGreaterThan(160);
    expect(sharp[(width / 2 - 5) * 4]).toBe(96);
    expect(clarity[(width / 2 - 5) * 4]).toBeLessThan(96);
  });
  it.each(['sharpen', 'clarity'] as const)('uses negative %s to soften contrast without changing alpha or the source', (key) => {
    const width = 512, height = 4, input = solid(width, height, 96);
    for (let y = 0; y < height; y++)
      for (let x = width / 2; x < width; x++) input.set([160, 160, 160, 255], (y * width + x) * 4);
    const before = input.slice();
    const edits = { ...DEFAULT_PHOTO_EDITS, [key]: -100 };
    const result = applyPhotoDetail(input, width, height, edits);
    expect(result[(width / 2 - 1) * 4]).toBeGreaterThan(96);
    expect(result[width / 2 * 4]).toBeLessThan(160);
    expect(result[(width / 2 - 5) * 4]).toBe(key === 'sharpen' ? 96 : expect.any(Number));
    if (key === 'clarity') expect(result[(width / 2 - 5) * 4]).toBeGreaterThan(96);
    expect(input).toEqual(before);
    expect(applyPhotoDetail(input, width, height, { ...edits, [key]: -200 })).toEqual(result);
    for (let i = 3; i < result.length; i += 4) expect(result[i]).toBe(input[i]);
    expect(applyPhotoDetail(solid(3, 3), 3, 3, edits)).toEqual(solid(3, 3));
    const transparent = new Uint8Array([255, 0, 0, 0, 128, 128, 128, 255, 0, 255, 0, 0]);
    expect(applyPhotoDetail(transparent, 3, 1, edits)).toEqual(transparent);
  });
  it('does not pull invisible RGB colors into the visible photo when sharpening', () => {
    const pixels = new Uint8Array([255, 0, 0, 0, 128, 128, 128, 255, 0, 255, 0, 0]);
    const result = applyPhotoDetail(pixels, 3, 1, {
      ...DEFAULT_PHOTO_EDITS,
      sharpen: 100,
      clarity: 100,
    });
    expect(Array.from(result.slice(4, 8))).toEqual([128, 128, 128, 255]);
    expect([result[3], result[11]]).toEqual([0, 0]);
  });
  it('darkens or lightens corners without altering the image center', () => {
    const input = solid(41, 41),
      center = (20 * 41 + 20) * 4;
    const dark = applyPhotoDetail(input, 41, 41, { ...DEFAULT_PHOTO_EDITS, vignette: 100 });
    const light = applyPhotoDetail(input, 41, 41, { ...DEFAULT_PHOTO_EDITS, vignette: -100 });
    expect(dark[0]).toBeLessThan(128);
    expect(light[0]).toBeGreaterThan(128);
    expect(dark[center]).toBe(128);
    expect(light[center]).toBe(128);
    expect(input[0]).toBe(128);
  });
  it('anchors vignette to the final crop rather than the discarded outer photo', () => {
    const edits = { ...DEFAULT_PHOTO_EDITS, cropRatio: '1:1' as const, vignette: 100 };
    const result = applyPhotoDetail(solid(80, 40), 80, 40, edits);
    expect(result[20 * 4]).toBeLessThan(128);
    expect(result[(20 * 80 + 40) * 4]).toBe(128);
  });
  it('uses stable monochrome grain, keeping repeated renders and alpha identical', () => {
    const input = solid(31, 31),
      edits = { ...DEFAULT_PHOTO_EDITS, grain: 65 };
    const first = applyPhotoDetail(input, 31, 31, edits);
    expect(first).toEqual(applyPhotoDetail(input, 31, 31, edits));
    expect(first).not.toEqual(input);
    for (let i = 0; i < first.length; i += 4) {
      expect(first[i]).toBe(first[i + 1]);
      expect(first[i + 1]).toBe(first[i + 2]);
      expect(first[i + 3]).toBe(255);
      expect(Math.abs(first[i] - 128)).toBeLessThanOrEqual(10);
    }
    const small = applyPhotoDetail(solid(3, 3), 3, 3, edits);
    const large = applyPhotoDetail(solid(9, 9), 9, 9, edits);
    expect(small[(1 * 3 + 1) * 4]).toBe(large[(4 * 9 + 4) * 4]);
  });
});
