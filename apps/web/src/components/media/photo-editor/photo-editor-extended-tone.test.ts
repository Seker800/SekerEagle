import { describe, expect, it } from 'vitest';
import { DEFAULT_PHOTO_EDITS, type PhotoEdits } from './photo-editor-model';
import { adjustedLuminance, applyExtendedTone } from './photo-editor-extended-tone';

const grey = (value: number) => new Uint8Array([value, value, value, 96]);
const apply = (pixel: Uint8Array, edits: Partial<PhotoEdits>) =>
  applyExtendedTone(pixel, { ...DEFAULT_PHOTO_EDITS, ...edits });

describe('extended photographic tone controls', () => {
  it('keeps neutral settings byte-identical and never changes source alpha or input buffers', () => {
    const input = new Uint8Array([38, 105, 192, 0, 220, 150, 60, 96]);
    expect(apply(input, {})).toEqual(input);
    const copy = input.slice();
    const result = apply(input, {
      temperature: 35,
      shadows: 30,
      highlights: -20,
      vibrance: 12,
      fade: 5,
    });
    expect(input).toEqual(copy);
    expect([result[3], result[7]]).toEqual([0, 96]);
  });
  it('uses the published GPUImage endpoint curves and inverse curves for signed controls', () => {
    expect(adjustedLuminance(0.1, 100, 0)).toBeCloseTo(Math.sqrt(0.1) - 0.076, 8);
    expect(adjustedLuminance(0.9, 0, -100)).toBeCloseTo(1 - Math.sqrt(0.1) + 0.08, 8);
    const lifted = adjustedLuminance(0.1, 100, 0);
    expect(adjustedLuminance(lifted, -100, 0)).toBeCloseTo(0.1, 6);
    const compressed = adjustedLuminance(0.9, 0, -100);
    expect(adjustedLuminance(compressed, 0, 100)).toBeCloseTo(0.9, 6);
  });
  it('targets dark and bright regions separately, including opposite directions', () => {
    expect(apply(grey(32), { shadows: 100 })[0]).toBeGreaterThan(32);
    expect(apply(grey(32), { shadows: -100 })[0]).toBeLessThan(32);
    expect(apply(grey(224), { shadows: 100 })[0]).toBe(224);
    expect(apply(grey(224), { highlights: -100 })[0]).toBeLessThan(224);
    expect(apply(grey(224), { highlights: 100 })[0]).toBeGreaterThan(224);
    expect(apply(grey(32), { highlights: -100 })[0]).toBe(32);
    expect(apply(grey(128), { highlights: -100, shadows: 100 })[0]).toBe(128);
  });
  it('makes a one-unit move gentle across the full tonal ramp', () => {
    for (const key of [
      'brightness',
      'highlights',
      'shadows',
      'whites',
      'blacks',
      'lightPerception',
      'fade',
    ] as const)
      for (let value = 0; value <= 255; value++)
        expect(Math.abs(apply(grey(value), { [key]: 1 })[0] - value)).toBeLessThanOrEqual(1);
  });
  it('retains tonal ordering at both endpoints and a mixed adjustment', () => {
    for (const edits of [
      { shadows: 100, highlights: -100 },
      { shadows: -100, highlights: 100 },
      { brightness: -25, blacks: -20, whites: 30, lightPerception: 45, fade: 20 },
    ]) {
      let previous = -1;
      for (let value = 0; value <= 255; value++) {
        const output = apply(grey(value), edits)[0];
        expect(output).toBeGreaterThanOrEqual(previous);
        previous = output;
      }
    }
  });
  it('offers independent additive brightness, black/white levels and faded output levels', () => {
    expect(apply(grey(0), { brightness: 100 })[0]).toBe(46);
    expect(apply(grey(0), { blacks: 100 })[0]).toBe(31);
    expect(apply(grey(255), { whites: -100 })[0]).toBe(217);
    expect(apply(grey(128), { whites: 100 })[0]).toBeGreaterThan(128);
    expect(apply(grey(128), { blacks: -100 })[0]).toBeLessThan(128);
    expect(apply(grey(0), { fade: 100 })[0]).toBe(41);
    expect(apply(grey(255), { fade: 100 })[0]).toBe(240);
  });
  it('separates warm/cool white balance and green/magenta tint', () => {
    const warm = apply(grey(128), { temperature: 100 }),
      cool = apply(grey(128), { temperature: -100 });
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[0]).toBeLessThan(cool[2]);
    const magenta = apply(grey(128), { tint: 100 }),
      green = apply(grey(128), { tint: -100 });
    expect(magenta[0]).toBeGreaterThan(magenta[1]);
    expect(magenta[2]).toBeGreaterThan(magenta[1]);
    expect(green[1]).toBeGreaterThan(green[0]);
    expect(green[1]).toBeGreaterThan(green[2]);
  });
  it('changes muted color vibrance while preserving neutral grey and already clipped primaries', () => {
    expect(apply(grey(128), { vibrance: 100 })).toEqual(grey(128));
    const red = new Uint8Array([255, 0, 0, 255]);
    expect(apply(red, { vibrance: 100 })).toEqual(red);
    const input = new Uint8Array([150, 125, 100, 255]);
    const increased = apply(input, { vibrance: 100 }),
      decreased = apply(input, { vibrance: -100 });
    expect(increased[0] - increased[2]).toBeGreaterThan(50);
    expect(decreased[0] - decreased[2]).toBeLessThan(50);
  });
  it('brilliance lifts dark/mid tones while restraining bright tones', () => {
    expect(apply(grey(32), { lightPerception: 100 })[0]).toBeGreaterThan(32);
    expect(apply(grey(128), { lightPerception: 100 })[0]).toBeGreaterThan(128);
    expect(apply(grey(224), { lightPerception: 100 })[0]).toBeLessThan(224);
  });
});
