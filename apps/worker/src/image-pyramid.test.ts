import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPyramidDescriptor, parseDeepZoomTilePath } from './image-pyramid';

test('builds a bounded Deep Zoom descriptor', () => {
  assert.deepEqual(buildPyramidDescriptor(8_000, 6_000), {
    width: 8_000,
    height: 6_000,
    tileSize: 512,
    overlap: 1,
    format: 'webp',
    maxLevel: 13,
  });
});

test('accepts only canonical generated tile paths', () => {
  assert.deepEqual(parseDeepZoomTilePath('13/12_4.webp'), {
    level: 13,
    x: 12,
    y: 4,
    relativeKey: '13/12_4.webp',
  });
  assert.throws(() => parseDeepZoomTilePath('../secret.webp'), /INVALID_PYRAMID_TILE/);
  assert.throws(() => parseDeepZoomTilePath('13/12_4.jpg'), /INVALID_PYRAMID_TILE/);
});
