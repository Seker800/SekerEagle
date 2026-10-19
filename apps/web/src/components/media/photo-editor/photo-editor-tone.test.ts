import { describe, expect, it } from 'vitest';
import { applyPhotoTone, photoContrast, srgbToLinear, linearToSrgb } from './photo-editor-tone';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';

describe('photographic adjustment calibration', () => {
  it('uses sRGB transfer functions that round-trip all 8-bit levels', () => {
    for (let channel = 0; channel <= 255; channel++)
      expect(linearToSrgb(srgbToLinear(channel / 255))).toBeCloseTo(channel / 255, 10);
  });
  it('one 0.05 EV step is a small change and one stop doubles linear light', () => {
    const pixel = new Uint8Array([128, 128, 128, 96]);
    expect(Array.from(applyPhotoTone(pixel, { ...DEFAULT_PHOTO_EDITS, exposure: 0.05 }))).toEqual([
      130, 130, 130, 96,
    ]);
    expect(Array.from(applyPhotoTone(pixel, { ...DEFAULT_PHOTO_EDITS, exposure: 1 }))).toEqual([
      176, 176, 176, 96,
    ]);
  });
  it('a fine 0.01 EV nudge changes any neutral 8-bit level by at most one code value', () => {
    for (const exposure of [-0.01, 0.01]) {
      for (let level = 0; level <= 255; level++) {
        const output = applyPhotoTone(new Uint8Array([level, level, level, 255]), {
          ...DEFAULT_PHOTO_EDITS,
          exposure,
        });
        expect(Math.abs(output[0] - level)).toBeLessThanOrEqual(1);
        expect(output[3]).toBe(255);
      }
    }
  });
  it('positive saturation scales chroma gently instead of adding a percentage of remaining headroom', () => {
    const pixel = new Uint8Array([132, 120, 108, 255]);
    expect(Array.from(applyPhotoTone(pixel, { ...DEFAULT_PHOTO_EDITS, saturation: 10 }))).toEqual([
      133, 120, 107, 255,
    ]);
    expect(Array.from(applyPhotoTone(pixel, { ...DEFAULT_PHOTO_EDITS, saturation: 100 }))).toEqual([
      142, 118, 94, 255,
    ]);
    expect(Array.from(applyPhotoTone(pixel, { ...DEFAULT_PHOTO_EDITS, saturation: -100 }))).toEqual(
      [122, 122, 122, 255],
    );
  });
  it('preserves black, white and middle grey while changing contrast monotonically', () => {
    for (const contrast of [-100, -50, -10, 0, 10, 50, 100]) {
      expect(photoContrast(0, contrast)).toBe(0);
      expect(photoContrast(1, contrast)).toBe(1);
      expect(photoContrast(0.5, contrast)).toBeCloseTo(0.5, 10);
      let previous = -1;
      for (let i = 0; i <= 255; i++) {
        const current = photoContrast(i / 255, contrast);
        expect(current).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    }
  });
  it('a small contrast adjustment stays subtle across the whole 8-bit ramp', () => {
    for (let i = 0; i <= 255; i++)
      expect(Math.abs(photoContrast(i / 255, 10) * 255 - i)).toBeLessThan(1);
  });
  it('uses the normalized inverse sigmoid for negative contrast', () => {
    for (const value of [0.01, 0.2, 0.5, 0.8, 0.99])
      expect(photoContrast(photoContrast(value, 75), -75)).toBeCloseTo(value, 10);
  });
});
