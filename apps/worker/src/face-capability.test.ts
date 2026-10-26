import assert from 'node:assert/strict';
import test from 'node:test';
import { availableProcessingJobKinds } from './processing-policy';
test('face capability and claim allowlist agree without disabling other work', () => {
  assert.equal(availableProcessingJobKinds(undefined, true), undefined);
  const configured = ['ANALYZE_PHOTO_FACES', 'GENERATE_EMBEDDING'] as const;
  assert.equal(availableProcessingJobKinds(configured, true), configured);
  assert.deepEqual(availableProcessingJobKinds(configured, false), ['GENERATE_EMBEDDING']);
  const withoutModels = availableProcessingJobKinds(undefined, false)!;
  assert.ok(!withoutModels.includes('ANALYZE_PHOTO_FACES'));
  assert.ok(!withoutModels.includes('GENERATE_AI_TAGS'));
  assert.ok(withoutModels.includes('RENDER_EDITED_COPY'));
  assert.ok(withoutModels.includes('GENERATE_EMBEDDING'));
  assert.deepEqual(availableProcessingJobKinds(['ANALYZE_PHOTO_FACES'], false), []);
});
