import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhotoMapBuildStep } from './photo-map-build';

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
  assert.match(query, /EagleMediaJob/);
  assert.match(query, /INTERACTIVE/);
  assert.doesNotMatch(query, /EaglePhotoMetadata|EaglePhotoLocation/);
});
