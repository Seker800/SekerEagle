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
