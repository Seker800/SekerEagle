import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
import { qualifyPersonReviewPairs, type ReviewFaceEvidence } from './photo-person-review-evidence';
const vector = (cosine: number, axis = 1) =>
  Array.from({ length: 128 }, (_, i) =>
    i === 0 ? cosine : i === axis ? Math.sqrt(1 - cosine * cosine) : 0,
  );
const sample = (
  personId: string,
  faceId: string,
  cosine: number,
  axis = 1,
): ReviewFaceEvidence => ({
  personId,
  faceId,
  assetId: 'photo-' + faceId,
  modelVersion: PHOTO_FACE_MODEL_VERSION,
  embedding: vector(cosine, axis),
});
const pair = { firstId: 'a', secondId: 'b' };
test('one face per group requires strong resemblance, not just a nearest neighbour', () => {
  for (const score of [0.25, 0.3, 0.4, 0.55, 0.599])
    assert.deepEqual(
      qualifyPersonReviewPairs([pair], [sample('a', 'a', 1), sample('b', 'b', score)]),
      [],
    );
  assert.equal(
    qualifyPersonReviewPairs([pair], [sample('a', 'a', 1), sample('b', 'b', 0.7)]).length,
    1,
  );
});
test('one lucky face match cannot speak for a conflicting group of people', () => {
  assert.deepEqual(
    qualifyPersonReviewPairs(
      [pair],
      [
        sample('a', 'a1', 1),
        sample('a', 'a2', 0, 2),
        sample('b', 'b1', 0.9),
        sample('b', 'b2', 0, 3),
      ],
    ),
    [],
  );
});
test('independent photos corroborate and the returned display faces are the actual best match', () => {
  const [result] = qualifyPersonReviewPairs(
    [pair],
    [
      sample('a', 'a1', 1),
      sample('a', 'a2', 0.99, 2),
      sample('b', 'b1', 0.65),
      sample('b', 'b2', 0.8),
    ],
  );
  assert.ok(result);
  assert.equal(result.firstFaceId, 'a1');
  assert.equal(result.secondFaceId, 'b2');
  assert.ok(result.similarity >= 0.5);
});
test('invalid, unsupported, same-photo and duplicate samples never create corroboration', () => {
  const a = sample('a', 'a', 1),
    b = sample('b', 'b', 0.8);
  for (const changed of [
    { ...b, modelVersion: 'unknown' },
    { ...b, embedding: Array(128).fill(0) },
    { ...b, embedding: [NaN] },
    { ...b, assetId: a.assetId },
  ])
    assert.deepEqual(qualifyPersonReviewPairs([pair], [a, changed]), []);
  const weak = sample('b', 'weak', 0.55);
  assert.deepEqual(
    qualifyPersonReviewPairs([pair], [a, weak, { ...weak, faceId: 'duplicate' }]),
    [],
  );
});
test('quality outranks volume and each identity occurs only once in a batch', () => {
  const rows = qualifyPersonReviewPairs(
    [
      { ...pair, firstCount: 9999n },
      { firstId: 'a', secondId: 'c', firstCount: 1n },
    ],
    [sample('a', 'a', 1), sample('b', 'b', 0.7), sample('c', 'c', 0.9)],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.secondId, 'c');
});
