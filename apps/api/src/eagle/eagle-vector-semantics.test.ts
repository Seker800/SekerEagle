import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cosineDistance,
  normalizeEmbedding,
  selectTopTagSuggestion,
  sphericalKMeans,
  validateEmbedding,
} from './eagle-vector-semantics';

test('validateEmbedding accepts a finite normalized vector with the configured dimension', () => {
  const vector = normalizeEmbedding([3, 4]);
  assert.deepEqual(validateEmbedding(vector, 2), vector);
});

test('validateEmbedding rejects wrong dimensions, non-finite values and zero vectors', () => {
  assert.throws(() => validateEmbedding([1], 2), /dimension/i);
  assert.throws(() => validateEmbedding([Number.NaN, 0], 2), /finite/i);
  assert.throws(() => validateEmbedding([0, 0], 2), /zero/i);
});

test('cosineDistance uses normalized direction and remains within the cosine distance range', () => {
  assert.equal(cosineDistance([1, 0], [1, 0]), 0);
  assert.equal(cosineDistance([1, 0], [0, 1]), 1);
  assert.equal(cosineDistance([1, 0], [-1, 0]), 2);
});

test('selectTopTagSuggestion scores each tag by its nearest enabled current prototype', () => {
  const selected = selectTopTagSuggestion(
    [1, 0],
    [
      { tagId: 'disabled', enabled: false, prototypes: [[1, 0]] },
      { tagId: 'car', enabled: true, prototypes: [[0.9, 0.1], [0, 1]] },
      { tagId: 'building', enabled: true, prototypes: [[0.4, 0.6]] },
      { tagId: 'no-current-center', enabled: true, prototypes: [] },
    ],
    0.5,
  );
  assert.equal(selected?.tagId, 'car');
  assert.equal(selected?.prototypeIndex, 0);
  assert.ok((selected?.score ?? 0) > 0.99);
});

test('selectTopTagSuggestion returns no suggestion below the reliability threshold', () => {
  assert.equal(
    selectTopTagSuggestion(
      [1, 0],
      [{ tagId: 'weak', enabled: true, prototypes: [[0, 1]] }],
      0.2,
    ),
    null,
  );
});

test('sphericalKMeans keeps one image as one center and separates obvious visual modes', () => {
  assert.deepEqual(sphericalKMeans([[1, 0]], { maxK: 8 }).centers, [[1, 0]]);
  const clustered = sphericalKMeans(
    [
      normalizeEmbedding([1, 0.01]),
      normalizeEmbedding([1, -0.01]),
      normalizeEmbedding([0.01, 1]),
      normalizeEmbedding([-0.01, 1]),
    ],
    { maxK: 8, minimumRelativeImprovement: 0.5 },
  );
  assert.equal(clustered.centers.length, 2);
  assert.deepEqual(
    clustered.clusterSizes.slice().sort((left: number, right: number) => left - right),
    [2, 2],
  );
});
