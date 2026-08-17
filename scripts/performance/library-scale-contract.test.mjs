import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDedicatedScaleTarget,
  evaluateScaleMeasurements,
} from './library-scale-contract.mjs';

test('scale verification only accepts the dedicated test database', () => {
  assert.doesNotThrow(() =>
    assertDedicatedScaleTarget(
      'postgresql://sekereagle:secret@postgres:5432/sekereagle_test?schema=public',
    ),
  );
  assert.throws(
    () =>
      assertDedicatedScaleTarget(
        'postgresql://sekereagle:secret@postgres:5432/sekereagle?schema=public',
      ),
    /sekereagle_test/,
  );
  assert.throws(
    () =>
      assertDedicatedScaleTarget(
        'postgresql://sekereagle:secret@example.com:5432/sekereagle_test?schema=public',
      ),
    /allowlist/,
  );
});

test('scale report rejects missing cardinality and slow core scenarios', () => {
  const failures = evaluateScaleMeasurements(
    {
      assetCount: 99_999,
      measurements: [
        { name: 'default-first-page', p95Ms: 201 },
        { name: 'deep-cursor', p95Ms: 150 },
      ],
    },
    {
      requiredAssetCount: 100_000,
      maximumP95Ms: {
        'default-first-page': 200,
        'deep-cursor': 200,
      },
    },
  );

  assert.deepEqual(failures, [
    'asset count 99999 is below required 100000',
    'default-first-page p95 201.00ms exceeds 200.00ms',
  ]);
});

test('scale report accepts measurements exactly on their thresholds', () => {
  assert.deepEqual(
    evaluateScaleMeasurements(
      {
        assetCount: 100_000,
        measurements: [
          { name: 'default-first-page', p95Ms: 200 },
          { name: 'deep-cursor', p95Ms: 500 },
        ],
      },
      {
        requiredAssetCount: 100_000,
        maximumP95Ms: {
          'default-first-page': 200,
          'deep-cursor': 500,
        },
      },
    ),
    [],
  );
});

test('scale report rejects a fast query that does not exercise any matching rows', () => {
  assert.deepEqual(
    evaluateScaleMeasurements(
      {
        assetCount: 100_000,
        measurements: [{ name: 'format-rating-filter', p95Ms: 1, itemCount: 0 }],
      },
      {
        requiredAssetCount: 100_000,
        maximumP95Ms: { 'format-rating-filter': 500 },
        minimumItemCounts: { 'format-rating-filter': 1 },
      },
    ),
    ['format-rating-filter returned 0 items; expected at least 1'],
  );
});

test('scale report rejects a default gallery plan that falls back to a sequential scan', () => {
  assert.deepEqual(
    evaluateScaleMeasurements(
      {
        assetCount: 100_000,
        measurements: [{ name: 'default-first-page', p95Ms: 20, itemCount: 40 }],
        plans: [{ name: 'default-first-page', nodes: ['Limit', 'Sort', 'Seq Scan'] }],
      },
      {
        requiredAssetCount: 100_000,
        maximumP95Ms: { 'default-first-page': 200 },
        forbiddenPlanNodes: { 'default-first-page': ['Seq Scan'] },
      },
    ),
    ['default-first-page plan contains forbidden node Seq Scan'],
  );
});
