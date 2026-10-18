import assert from 'node:assert/strict';
import test from 'node:test';
import { cosineSimilarity, validateFaceResult } from './photo-faces';
test('face model output must be bounded, finite and versioned', () => {
  assert.throws(() => validateFaceResult({ version: 'wrong', faces: [] }), /FACE/);
  assert.throws(
    () =>
      validateFaceResult({
        version: 'yunet-2023mar-sface-2021dec-v1',
        faces: [{ box: [0, 0, 1, 1], confidence: 1, embedding: [NaN] }],
      }),
    /FACE/,
  );
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});
