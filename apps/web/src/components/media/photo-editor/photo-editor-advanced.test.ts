import { describe, expect, it } from 'vitest';
import { processPhotoPixels } from './photo-editor-photon';
import { DEFAULT_PHOTO_EDITS } from './photo-editor-model';

const pixel = (r: number, g: number, b: number, a = 255) => new Uint8Array([r, g, b, a]);
const process = (input: Uint8Array, changes: Record<string, number>, width = input.length / 4) =>
  processPhotoPixels(input, width, input.length / 4 / width, {
    ...DEFAULT_PHOTO_EDITS,
    ...changes,
  });

describe('advanced adjustments through the shared preview / export pipeline', () => {
  it('selectively changes red HSL without changing blue, grey or transparency', () => {
    const input = new Uint8Array([
      200, 50, 50, 96, 30, 50, 210, 255, 120, 120, 120, 255, 255, 0, 0, 0,
    ]);
    const result = process(input, { hslRedSaturation: -100 });
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
    expect(result.slice(4)).toEqual(input.slice(4));
    expect(result[3]).toBe(96);
    expect(input[0]).toBe(200);
  });
  it.each([
    ['Red', [200, 50, 50]],
    ['Orange', [200, 125, 50]],
    ['Yellow', [200, 200, 50]],
    ['Green', [50, 200, 50]],
    ['Aqua', [50, 200, 200]],
    ['Blue', [50, 50, 200]],
    ['Purple', [125, 50, 200]],
    ['Magenta', [200, 50, 200]],
  ] as const)('connects all three %s HSL axes in both directions', (band, rgb) => {
    const input = pixel(rgb[0], rgb[1], rgb[2]);
    for (const axis of ['Hue', 'Saturation', 'Luminance']) {
      const positive = process(input, { [`hsl${band}${axis}`]: 70 });
      const negative = process(input, { [`hsl${band}${axis}`]: -70 });
      expect(positive).not.toEqual(input);
      expect(negative).not.toEqual(input);
      expect(positive).not.toEqual(negative);
      expect(positive[3]).toBe(255);
    }
  });
  it('wraps HSL red selection smoothly across the hue seam', () => {
    const a = process(pixel(200, 50, 51), { hslRedLuminance: 50 });
    const b = process(pixel(200, 51, 50), { hslRedLuminance: 50 });
    expect(Math.abs(a[0] - b[0])).toBeLessThanOrEqual(1);
    expect(Math.abs(a[1] - b[2])).toBeLessThanOrEqual(1);
  });
  it('applies master and RGB curves independently with exact neutral identity', () => {
    const input = pixel(128, 128, 128, 70);
    expect(process(input, {})).toEqual(input);
    const master = process(input, { curveMaster2: 20 });
    expect(master[0]).toBeGreaterThan(128);
    expect(master[0]).toBe(master[1]);
    const red = process(input, { curveRed2: -20 });
    expect(red[0]).toBeLessThan(128);
    expect(Array.from(red.slice(1))).toEqual([128, 128, 70]);
    expect(process(pixel(0, 0, 0), { curveMaster0: 20 })[0]).toBeGreaterThan(0);
    expect(process(pixel(255, 255, 255), { curveMaster4: -20 })[0]).toBeLessThan(255);
  });
  it.each(['Red', 'Green', 'Blue'] as const)(
    'connects the %s curve to only its channel',
    (channel) => {
      const result = process(pixel(128, 128, 128), { [`curve${channel}2`]: 20 });
      const index = ['Red', 'Green', 'Blue'].indexOf(channel);
      for (let c = 0; c < 3; c++) if (c !== index) expect(result[c]).toBe(128);
      expect(result[index]).toBeGreaterThan(128);
    },
  );
  it('grades tonal zones separately and has no tint until saturation is added', () => {
    const input = new Uint8Array([40, 40, 40, 255, 128, 128, 128, 255, 215, 215, 215, 255]);
    expect(process(input, { gradeShadowsHue: 220 })).toEqual(input);
    const result = process(input, { gradeShadowsHue: 240, gradeShadowsSaturation: 80 });
    expect(result[2] - result[0]).toBeGreaterThan(result[10] - result[8]);
    const warm = process(input, { gradeHighlightsHue: 30, gradeHighlightsSaturation: 80 });
    expect(warm[8]).toBeGreaterThan(warm[10]);
    expect(process(input, { gradeMidtonesLuminance: 60 })[4]).toBeGreaterThan(128);
    expect(
      process(input, { gradeShadowsHue: 240, gradeShadowsSaturation: 80, gradeBalance: 80 }),
    ).not.toEqual(result);
  });
  it('reduces luminance and chroma noise while retaining strong boundaries', () => {
    const input = new Uint8Array(9 * 9 * 4);
    for (let y = 0; y < 9; y++)
      for (let x = 0; x < 9; x++) {
        const value = x < 5 ? 85 + ((x + y) % 2) * 20 : 220;
        input.set([value, value, value, 255], (y * 9 + x) * 4);
      }
    const smooth = process(input, { luminanceNoise: 100 }, 9);
    const center = (4 * 9 + 2) * 4;
    expect(Math.abs(smooth[center] - 95)).toBeLessThan(Math.abs(input[center] - 95));
    expect(smooth[(4 * 9 + 6) * 4]).toBeGreaterThan(210);
    const colored = pixel(140, 110, 135);
    const field = new Uint8Array(3 * 3 * 4);
    for (let i = 0; i < field.length; i += 4) field.set([128, 128, 128, 255], i);
    field.set(colored, 16);
    const clean = process(field, { colorNoise: 100 }, 3);
    expect(Math.max(...clean.slice(16, 19)) - Math.min(...clean.slice(16, 19))).toBeLessThan(25);
  });
  it('removes haze or adds atmosphere and keeps alpha and constant fields intact', () => {
    const input = new Uint8Array(24 * 8 * 4);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 24; x++)
        input.set(x < 12 ? [120, 145, 165, 255] : [220, 225, 230, 255], (y * 24 + x) * 4);
    const clear = process(input, { dehaze: 70 }, 24);
    const haze = process(input, { dehaze: -70 }, 24);
    expect(clear[0]).toBeLessThan(input[0]);
    expect(haze[0]).toBeGreaterThan(input[0]);
    expect(
      process(pixel(128, 128, 128, 80), { dehaze: 100, luminanceNoise: 100, colorNoise: 100 }),
    ).toEqual(pixel(128, 128, 128, 80));
  });
  it('skips invisible RGB and preserves alpha for all advanced stages', () => {
    const input = new Uint8Array([255, 0, 0, 0, 120, 140, 180, 96, 100, 100, 100, 255]);
    const result = process(input, {
      hslRedHue: 80,
      curveMaster2: 30,
      gradeMidtonesSaturation: 50,
      dehaze: 60,
      luminanceNoise: 80,
      colorNoise: 80,
    });
    expect(result.slice(0, 4)).toEqual(input.slice(0, 4));
    expect([result[7], result[11]]).toEqual([96, 255]);
  });
});
