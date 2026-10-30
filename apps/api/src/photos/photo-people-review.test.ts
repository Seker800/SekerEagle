import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';
import { rankPhotoPeopleReviewCandidates } from './photo-people-review';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
const embedding = [1, ...Array<number>(127).fill(0)];

test('review uses a scoped repeatable snapshot and never exposes biometric prototypes', async () => {
  const queries: string[] = [];
  let where: unknown;
  const service = new PhotoManagementService({
    $transaction: async (run: (tx: unknown) => unknown, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead', timeout: 15000 });
      return run({
        $queryRaw: async (query: { text: string; values: unknown[] }) => {
          queries.push(query.text);
          assert.ok(query.values.includes('owner'));
          if (queries.length === 1)
            return [
              { id: 'a', prototype: embedding, modelVersion: PHOTO_FACE_MODEL_VERSION, count: 30n },
              { id: 'b', prototype: embedding, modelVersion: PHOTO_FACE_MODEL_VERSION, count: 20n },
            ];
          if (queries.length === 2) return [];
          return ['a', 'b'].map((id) => ({
            faceId: 'face-' + id,
            personId: id,
            assetId: 'photo-' + id,
            modelVersion: PHOTO_FACE_MODEL_VERSION,
            embedding,
          }));
        },
        eaglePhotoPersonSeparation: { findMany: async () => [] },
        eaglePhotoPerson: {
          findMany: async (query: { where: unknown }) => {
            where = query.where;
            return ['a', 'b'].map((id) => ({
              id,
              prototype: [1],
              name: null,
              faces: [
                {
                  id: 'face-' + id,
                  assetRevision: 1,
                  asset: { mediaRevision: 1, byteSize: 1n, renditions: [] },
                },
              ],
            }));
          },
        },
      });
    },
  } as never);
  const result = await service.reviewPeople('owner', false);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]?.first.photoCount, 30);
  assert.equal('prototype' in result.pairs[0]!.first, false);
  assert.equal(queries.length, 3);
  for (const sql of queries.slice(0, 2)) {
    assert.match(sql, /"mediaRevision"/);
    assert.match(sql, /"isPrivate" = false/);
    assert.match(sql, /"libraryMode" = 'PHOTO'/);
  }
  assert.match(queries[0]!, /count\(DISTINCT/);
  assert.match(queries[0]!, /LIMIT 400/);
  assert.match(queries[1]!, /x\."personId" IN/);
  assert.match(queries[1]!, /y\."personId" IN/);
  assert.deepEqual(where, {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    id: { in: ['a', 'b'] },
    marksAssetsPrivate: false,
  });
});

test('ranking prefers likeness then photo volume, filters incompatible/invalid vectors and same-frame pairs, and caps output', () => {
  const candidate = (id: string, count = 1, prototype = embedding, modelVersion = 'test') => ({
    id,
    count: BigInt(count),
    prototype,
    modelVersion,
  });
  const people = [
    candidate('one'),
    candidate('large', 100),
    candidate('medium', 50),
    candidate('other-model', 1000, embedding, 'other'),
    candidate('unrelated', 1000, [0, 1, ...Array<number>(126).fill(0)]),
    candidate('bad', 1000, [NaN]),
    candidate('zero', 1000, Array<number>(128).fill(0)),
  ];
  const pairs = rankPhotoPeopleReviewCandidates(people, [{ firstId: 'large', secondId: 'one' }]);
  assert.deepEqual(
    pairs.map((p) => [p.firstId, p.secondId]),
    [
      ['large', 'medium'],
      ['one', 'medium'],
    ],
  );
  assert.equal(
    rankPhotoPeopleReviewCandidates(
      Array.from({ length: 20 }, (_, i) => candidate(String(i))),
      [],
    ).length,
    100,
  );
  assert.deepEqual(rankPhotoPeopleReviewCandidates([], []), []);
});

test('never asks about weak lookalikes merely because they are the nearest available pair', () => {
  const vector = (score: number) => [
    score,
    Math.sqrt(1 - score * score),
    ...Array<number>(126).fill(0),
  ];
  const pairs = rankPhotoPeopleReviewCandidates(
    [
      { id: 'a', prototype: embedding, modelVersion: 'test', count: 500n },
      { id: 'b', prototype: vector(0.3), modelVersion: 'test', count: 400n },
    ],
    [],
  );
  assert.deepEqual(pairs, []);
});

test('ranks likeness before photo volume so a large unrelated group cannot jump ahead', () => {
  const axis = (i: number, j: number, score: number) =>
    Array.from({ length: 128 }, (_, k) =>
      k === i ? score : k === j ? Math.sqrt(1 - score * score) : 0,
    );
  const pairs = rankPhotoPeopleReviewCandidates(
    [
      { id: 'strong-a', prototype: axis(0, 1, 1), modelVersion: 'test', count: 2n },
      { id: 'strong-b', prototype: axis(0, 1, 0.85), modelVersion: 'test', count: 2n },
      { id: 'weak-a', prototype: axis(2, 3, 1), modelVersion: 'test', count: 2000n },
      { id: 'weak-b', prototype: axis(2, 3, 0.42), modelVersion: 'test', count: 2000n },
    ],
    [],
  );
  assert.equal(pairs[0]?.firstId, 'strong-a');
  assert.equal(pairs[0]?.secondId, 'strong-b');
});
