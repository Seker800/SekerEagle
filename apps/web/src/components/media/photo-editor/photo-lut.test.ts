import { describe, expect, it } from 'vitest';
import { applyPhotoLut, parseCubeLut, parsePngLut } from './photo-lut';

const cube = (invert = false) =>
  `TITLE "Synthetic test"\nLUT_3D_SIZE 2\n${Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1].map((v) => (invert ? 1 - v : v)).join(' ')).join('\n')}`;
describe('portable personal LUTs', () => {
  it('parses red-fastest cube ordering, interpolates interiors and retains alpha', () => {
    const pixels = new Uint8Array([40, 90, 180, 97, 255, 0, 0, 0]);
    expect(applyPhotoLut(pixels, parseCubeLut(cube()), 100)).toEqual(pixels);
    expect(applyPhotoLut(pixels, parseCubeLut(cube(true)), 100)).toEqual(
      new Uint8Array([215, 165, 75, 97, 0, 255, 255, 0]),
    );
    expect(applyPhotoLut(pixels, parseCubeLut(cube(true)), 50)).toEqual(
      new Uint8Array([128, 128, 128, 97, 128, 128, 128, 0]),
    );
    expect(applyPhotoLut(pixels, parseCubeLut(cube(true)), 0)).toBe(pixels);
    expect(pixels[0]).toBe(40);
  });
  it('honors domains and rejects unsupported or malformed tables before allocation', () => {
    const lut = parseCubeLut(
      cube().replace('LUT_3D_SIZE', 'DOMAIN_MIN 0.1 0.1 0.1\nDOMAIN_MAX 0.9 0.9 0.9\nLUT_3D_SIZE'),
    );
    expect(applyPhotoLut(new Uint8Array([0, 128, 255, 255]), lut, 100)).toEqual(
      new Uint8Array([0, 128, 255, 255]),
    );
    for (const invalid of [
      'LUT_3D_SIZE 99999',
      cube() + '\n0 0 0',
      cube().replace('0 0 0', 'NaN 0 0'),
      'LUT_1D_SIZE 2\n0 0 0\n1 1 1',
      cube().replace('LUT_3D_SIZE 2', 'DOMAIN_MAX 0 0 0\nLUT_3D_SIZE 2'),
      cube().replace('LUT_3D_SIZE 2', 'UNKNOWN 2\nLUT_3D_SIZE 2'),
    ])
      expect(() => parseCubeLut(invalid)).toThrow();
  });
  it('reads tiled PNG channel axes without flipping or treating LUT pixels as a photo', () => {
    const width = 64,
      size = 16,
      pixels = new Uint8ClampedArray(width * width * 4);
    for (let b = 0; b < size; b++)
      for (let g = 0; g < size; g++)
        for (let r = 0; r < size; r++) {
          const p = ((Math.floor(b / 4) * size + g) * width + (b % 4) * size + r) * 4;
          pixels.set([r * 17, g * 17, b * 17, 255], p);
        }
    const lut = parsePngLut(pixels, width, width);
    expect(applyPhotoLut(new Uint8Array([25, 120, 213, 80]), lut, 100)).toEqual(
      new Uint8Array([25, 120, 213, 80]),
    );
    expect(() => parsePngLut(pixels, 63, 64)).toThrow();
    pixels[3] = 0;
    expect(
      applyPhotoLut(new Uint8Array([25, 120, 213, 80]), parsePngLut(pixels, 64, 64), 100),
    ).toEqual(new Uint8Array([25, 120, 213, 80]));
  });
});
export { cube };
