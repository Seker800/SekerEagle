import assert from 'node:assert/strict';
import test from 'node:test';
import { extractRepresentativeColors } from './eagle-color-palette';

test('extracts weighted representative colors and ignores transparent pixels', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 250, 8, 8, 255, 0, 0, 255, 255, 0, 255, 0, 0]);

  const palette = extractRepresentativeColors(pixels, 4, 4, 3);

  assert.equal(palette.length, 2);
  assert.equal(palette[0]!.hex, '#fd0404');
  assert.equal(palette[0]!.weight, 2 / 3);
  assert.equal(palette[1]!.hex, '#0000ff');
  assert.equal(palette[1]!.weight, 1 / 3);
  assert.ok(Number.isFinite(palette[0]!.labL));
  assert.ok(Number.isFinite(palette[0]!.labA));
  assert.ok(Number.isFinite(palette[0]!.labB));
});

test('returns an empty palette when every pixel is transparent', () => {
  assert.deepEqual(extractRepresentativeColors(Buffer.from([10, 20, 30, 0]), 4, 1, 6), []);
});

test('weights partially transparent pixels instead of treating hidden color as fully visible', () => {
  const palette = extractRepresentativeColors(
    Buffer.from([255, 0, 0, 255, 0, 0, 255, 128]),
    4,
    2,
    6,
  );

  assert.equal(palette.length, 2);
  assert.equal(palette[0]!.hex, '#ff0000');
  assert.ok(Math.abs(palette[0]!.weight - 2 / 3) < 0.01);
  assert.equal(palette[1]!.hex, '#0000ff');
  assert.ok(Math.abs(palette[1]!.weight - 1 / 3) < 0.01);
});

test('merges perceptually close colors and drops tiny noise clusters', () => {
  const pixels = Buffer.from([
    ...Array.from({ length: 48 }, () => [200, 40, 35, 255]).flat(),
    ...Array.from({ length: 48 }, () => [205, 42, 38, 255]).flat(),
    0,
    255,
    0,
    255,
  ]);

  const palette = extractRepresentativeColors(pixels, 4, 97, 6);

  assert.equal(palette.length, 1);
  assert.match(palette[0]!.hex, /^#c[89a-f]/);
  assert.ok(palette[0]!.weight > 0.98);
});
