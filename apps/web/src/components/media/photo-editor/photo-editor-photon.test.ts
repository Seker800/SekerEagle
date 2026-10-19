import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it } from 'vitest';
import { initSync } from '@silvia-odwyer/photon/photon_rs.js';
import { processPhotoPixels } from './photo-editor-photon';
import { DEFAULT_PHOTO_EDITS, photoCrop } from './photo-editor-model';

beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@silvia-odwyer/photon/photon_rs_bg.wasm'),
    ),
  });
});

describe('real Photon WASM photo processing', () => {
  const pixels = new Uint8Array([32, 100, 180, 255, 220, 120, 40, 96, 0, 0, 0, 0]);
  it('keeps every original pixel and alpha unchanged at neutral settings', () => {
    expect(processPhotoPixels(pixels, 3, 1, DEFAULT_PHOTO_EDITS)).toEqual(pixels);
  });
  it('uses calibrated EV exposure and preserves alpha', () => {
    const result = processPhotoPixels(new Uint8Array([128, 128, 128, 96]), 1, 1, {
      ...DEFAULT_PHOTO_EDITS,
      exposure: 0.05,
    });
    expect(Array.from(result)).toEqual([130, 130, 130, 96]);
    expect(pixels[0]).toBe(32);
  });
  it('produces neutral grey at complete desaturation without changing transparency', () => {
    const result = processPhotoPixels(pixels, 3, 1, { ...DEFAULT_PHOTO_EDITS, saturation: -100 });
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
    expect(result[7]).toBe(96);
    expect(result[11]).toBe(0);
  });
  it('zero filter intensity matches the adjusted input exactly', () => {
    const adjusted = {
      ...DEFAULT_PHOTO_EDITS,
      exposure: 0.1,
      contrast: 15,
      saturation: 20,
      gamma: 10,
    };
    expect(
      processPhotoPixels(pixels, 3, 1, { ...adjusted, filter: 'vintage', filterStrength: 0 }),
    ).toEqual(processPhotoPixels(pixels, 3, 1, adjusted));
  });
  it('applies presets deterministically and keeps all alpha values', () => {
    for (const filter of ['vintage', 'oceanic', 'monochrome'] as const) {
      const edits = { ...DEFAULT_PHOTO_EDITS, filter, filterStrength: 65 };
      const result = processPhotoPixels(pixels, 3, 1, edits);
      expect(result).toEqual(processPhotoPixels(pixels, 3, 1, edits));
      expect([result[3], result[7], result[11]]).toEqual([255, 96, 0]);
    }
  });
  it.each([
    'brightness',
    'lightPerception',
    'highlights',
    'shadows',
    'whites',
    'blacks',
    'vibrance',
    'temperature',
    'tint',
    'fade',
    'sharpen',
    'clarity',
    'grain',
    'vignette',
  ] as const)('connects %s to the shared preview/export pixel pipeline', (key) => {
    const width = 48,
      height = 32,
      input = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4,
          value = x < 24 ? 30 + x * 2 : 165 + (x % 8) * 10;
        input.set(
          [value, Math.min(255, value + 10), Math.max(0, value - 15), y === 0 ? 96 : 255],
          offset,
        );
      }
    const result = processPhotoPixels(input, width, height, {
      ...DEFAULT_PHOTO_EDITS,
      [key]: key === 'highlights' ? -60 : 60,
    });
    expect(result).not.toEqual(input);
    for (let i = 3; i < input.length; i += 4) expect(result[i]).toBe(input[i]);
  });
});

describe('preview and export crop coordinates', () => {
  it('keeps original geometry unchanged', () => {
    expect(photoCrop(4000, 3000, DEFAULT_PHOTO_EDITS)).toEqual({
      orientedWidth: 4000,
      orientedHeight: 3000,
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    });
  });
  it('maps a square crop to the same source area at preview and original resolution', () => {
    const edits = { ...DEFAULT_PHOTO_EDITS, cropRatio: '1:1' as const, cropX: 0.75 };
    expect(photoCrop(4000, 3000, edits)).toMatchObject({ x: 750, y: 0, width: 3000, height: 3000 });
    expect(photoCrop(1000, 750, edits)).toMatchObject({ x: 188, y: 0, width: 750, height: 750 });
  });
  it('uses oriented dimensions after rotation and clamps the crop inside the image', () => {
    expect(
      photoCrop(4000, 3000, { ...DEFAULT_PHOTO_EDITS, rotation: 90, cropRatio: '1:1', cropY: 2 }),
    ).toEqual({
      orientedWidth: 3000,
      orientedHeight: 4000,
      x: 0,
      y: 1000,
      width: 3000,
      height: 3000,
    });
  });
});
