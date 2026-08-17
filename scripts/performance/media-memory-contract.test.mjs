import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMediaMemoryTarget,
  evaluateMediaMemoryMeasurements,
  percentile,
} from './media-memory-contract.mjs';

test('media memory verification only accepts the dedicated test database', () => {
  assert.doesNotThrow(() =>
    assertMediaMemoryTarget(
      'postgresql://sekereagle:secret@postgres:5432/sekereagle_test?schema=public',
    ),
  );
  assert.throws(
    () =>
      assertMediaMemoryTarget(
        'postgresql://sekereagle:secret@localhost:5432/sekereagle?schema=public',
      ),
    /sekereagle_test/,
  );
  assert.throws(
    () =>
      assertMediaMemoryTarget(
        'postgresql://sekereagle:secret@example.com:5432/sekereagle_test?schema=public',
      ),
    /allowlist/,
  );
});

test('media memory report rejects missing, excessive and original-reading measurements', () => {
  assert.deepEqual(
    evaluateMediaMemoryMeasurements(
      {
        measurements: [
          { name: 'preview-50mp', peakRssMiB: 220, originalGetCount: 1 },
          { name: 'palette-50mp', peakRssMiB: 190, originalGetCount: 1 },
        ],
      },
      {
        maximumPeakRssMiB: { 'preview-50mp': 200, 'palette-50mp': 192 },
        maximumOriginalGetCount: { 'preview-50mp': 0, 'palette-50mp': 0 },
        requiredMeasurements: ['preview-50mp', 'palette-50mp', 'pyramid-50mp'],
      },
    ),
    [
      'pyramid-50mp measurement is missing',
      'preview-50mp peak RSS 220.00MiB exceeds 200.00MiB',
      'preview-50mp original GET count 1 exceeds 0',
      'palette-50mp original GET count 1 exceeds 0',
    ],
  );
});

test('media memory report accepts measurements exactly on their limits', () => {
  assert.deepEqual(
    evaluateMediaMemoryMeasurements(
      {
        measurements: [
          { name: 'preview-50mp', peakRssMiB: 200, originalGetCount: 0 },
          { name: 'palette-50mp', peakRssMiB: 192, originalGetCount: 0 },
        ],
      },
      {
        maximumPeakRssMiB: { 'preview-50mp': 200, 'palette-50mp': 192 },
        maximumOriginalGetCount: { 'preview-50mp': 0, 'palette-50mp': 0 },
        requiredMeasurements: ['preview-50mp', 'palette-50mp'],
      },
    ),
    [],
  );
});

test('percentile is deterministic for unsorted samples', () => {
  assert.equal(percentile([9, 1, 5, 3, 7], 0.5), 5);
  assert.equal(percentile([9, 1, 5, 3, 7], 0.95), 9);
});
