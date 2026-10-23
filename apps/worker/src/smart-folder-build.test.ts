import assert from 'node:assert/strict';
import test from 'node:test';
import { smartFolderRetry, validateQueryVector } from './smart-folder-build';

test('smart-folder vectors require the fixed normalized finite 1024-dimensional space', () => {
  assert.doesNotThrow(() => validateQueryVector([1, ...Array(1023).fill(0)]));
  for (const vector of [
    [],
    [1, 0],
    Array(1024).fill(0),
    Array(1024).fill(NaN),
    Array(1024).fill(1),
  ])
    assert.throws(() => validateQueryVector(vector));
});

test('failed inference backs off and eventually requires an explicit retry', () => {
  const now = new Date('2026-10-23T00:00:00Z');
  assert.equal(smartFolderRetry(1, now).status, 'PENDING');
  assert.ok(smartFolderRetry(2, now).availableAt > smartFolderRetry(1, now).availableAt);
  assert.equal(smartFolderRetry(5, now).status, 'FAILED');
});
