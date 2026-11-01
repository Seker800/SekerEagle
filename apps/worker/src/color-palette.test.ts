import assert from 'node:assert/strict';
import test from 'node:test';
import { extractRepresentativeColors } from './color-palette';

test('shared Eagle quantization ignores alpha below 170 and preserves occupied area', () => {
  const pixels = Buffer.from(
    [
      ...Array.from({ length: 80 }, () => [255, 255, 255, 255]),
      ...Array.from({ length: 20 }, () => [0, 0, 0, 255]),
      [0, 255, 0, 0],
      [255, 0, 0, 128],
    ].flat(),
  );
  const colors = extractRepresentativeColors(pixels, 4, 102);
  assert.deepEqual(
    colors.map(({ hex, weight }) => ({ hex, weight })),
    [
      { hex: '#fcfcfc', weight: 0.8 },
      { hex: '#040404', weight: 0.2 },
    ],
  );
  assert.equal(colors[0]!.labL, 99);
  assert.deepEqual(extractRepresentativeColors(Buffer.from([1, 2, 3, 0]), 4, 1), []);
});
