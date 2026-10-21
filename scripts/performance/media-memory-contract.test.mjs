import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertMediaMemoryTarget,
  evaluateMediaMemoryMeasurements,
  percentile,
} from './media-memory-contract.mjs';

test('PostgreSQL has an explicit shared-memory budget for parallel image-library queries', async () => {
  const compose = await readFile(
    new URL('../../deploy/mac/docker-compose.yml', import.meta.url),
    'utf8',
  );
  assert.match(compose, /postgres:[\s\S]*?shm_size:\s*512m/u);
});

test('desktop media paths stay single-stream and gesture-driven', async () => {
  const [controller, page, scripts] = await Promise.all([
    readFile(
      new URL('../../apps/desktop/src/main/media-cache-controller.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../apps/web/src/components/eagle/SekerEaglePage.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(controller, /\.tee\(\)/u);
  assert.doesNotMatch(page, /onPointerEnter=.*AssetDrag|onFocus=.*AssetDrag/u);
  assert.match(page, /onDragStart=.*handleAssetDragStart/u);
  assert.match(scripts, /"performance:desktop-cache:100k"/u);
  assert.match(scripts, /"performance:verify"/u);
});

test('local MinIO slows metadata scans for tile-heavy libraries', async () => {
  const compose = await readFile(
    new URL('../../deploy/mac/docker-compose.yml', import.meta.url),
    'utf8',
  );
  assert.match(compose, /MINIO_SCANNER_SPEED:\s*\$\{MINIO_SCANNER_SPEED:-slowest\}/u);
});

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

test('the release memory gate covers the current 120MP policy rather than accepting 50MP-only evidence', async () => {
  const { mediaMemoryLimits } = await import('./media-memory-limits.mjs');
  const missing = evaluateMediaMemoryMeasurements({ measurements: [] }, mediaMemoryLimits);
  for (const name of [
    'viewer-preview-120mp',
    'palette-120mp',
    'pyramid-viewer-120mp',
    'worker-preview-png-120mp',
    'worker-preview-heif-64mp',
  ])
    assert.ok(missing.includes(`${name} measurement is missing`));
  assert.ok(
    evaluateMediaMemoryMeasurements(
      { measurements: [{ name: 'worker-preview-png-120mp', peakRssMiB: 2100 }] },
      mediaMemoryLimits,
    ).some((x) => x.includes('exceeds')),
  );
  assert.ok(
    evaluateMediaMemoryMeasurements(
      { measurements: [{ name: 'viewer-preview-120mp', peakRssMiB: NaN, originalGetCount: 0 }] },
      mediaMemoryLimits,
    ).some((x) => x.includes('invalid')),
  );
});
