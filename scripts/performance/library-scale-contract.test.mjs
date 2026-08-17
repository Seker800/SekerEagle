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
