import assert from 'node:assert/strict';
import test from 'node:test';
import { sphericalKMeans } from './index';

test('mini-batch spherical k-means separates stable visual modes deterministically', () => {
  const input = [
    [1, 0],
    [0.99, 0.01],
    [0, 1],
    [0.01, 0.99],
  ];
  const first = sphericalKMeans(input, { minimumRelativeImprovement: 0.5, batchSize: 2 });
  const second = sphericalKMeans(input, { minimumRelativeImprovement: 0.5, batchSize: 2 });
  assert.equal(first.centers.length, 2);
  assert.deepEqual(first, second);
});

test('robust center recomputation trims a small far-away tail', () => {
  const input = [...Array.from({ length: 19 }, () => [1, 0]), [0, 1]];
  const result = sphericalKMeans(input, {
    maxK: 1,
    batchSize: 5,
    outlierTrimFraction: 0.05,
  });
  assert.ok(result.centers[0]![0]! > 0.999);
  assert.ok(Math.abs(result.centers[0]![1]!) < 0.001);
});
