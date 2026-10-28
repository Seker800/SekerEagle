import assert from 'node:assert/strict';
import test from 'node:test';
import { canAdvancePhotoMap, runPhotoMapBuildStep } from './photo-map-build';

test('no due dirty owner means no point extraction, aggregation or gallery access', async () => {
  let query = '';
  const client = {
    $queryRaw: async (input: { text: string }) => {
      query = input.text;
      return [];
    },
  };
  assert.equal(await runPhotoMapBuildStep(client as never), false);
  assert.match(query, /SKIP LOCKED/);
  assert.match(query, /"availableAt"<=now\(\)/);
  assert.doesNotMatch(query, /EagleMediaJob/);
  assert.doesNotMatch(query, /INTERACTIVE|PENDING/);
  assert.doesNotMatch(query, /PROCESSING/);
  assert.match(query, /builtVersion/);
  assert.doesNotMatch(query, /EaglePhotoMetadata|EaglePhotoLocation/);
});

test('a spare NAS slot advances maps without waiting for all media to finish', () => {
  assert.equal(canAdvancePhotoMap(30000, 0, 1, 2), true);
  assert.equal(canAdvancePhotoMap(30000, 0, 2, 2), false);
  assert.equal(canAdvancePhotoMap(14000, 0, 0, 2), false);
  assert.equal(canAdvancePhotoMap(15000, 0, 0, 1), true);
});

for (const stage of ['POINTS', 'LEVELS'] as const)
  test(`a lost lease cannot publish map ${stage}`, async () => {
    const failures: Array<{ where: unknown; data: { lastError: string; availableAt: Date } }> = [];
    const claim = {
      ownerId: 'owner',
      libraryMode: 'PHOTO',
      attempts: 0,
      buildingSnapshotId: stage === 'LEVELS' ? 'snapshot' : null,
    };
    const client = {
      $queryRaw: async () => [claim],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          eaglePhotoMapState: {
            findUniqueOrThrow: async () => ({ ...claim, leaseToken: 'another-lease' }),
            updateMany: async () => ({ count: 0 }),
          },
        }),
      eaglePhotoMapState: {
        updateMany: async (input: (typeof failures)[number]) => {
          failures.push(input);
          return { count: 0 };
        },
      },
    };
    await assert.rejects(runPhotoMapBuildStep(client as never), /MAP_LEASE_LOST/);
    assert.equal(failures[0]!.data.lastError, 'INDEX_BUILD_FAILED');
    assert.ok(failures[0]!.data.availableAt.getTime() > Date.now());
  });
