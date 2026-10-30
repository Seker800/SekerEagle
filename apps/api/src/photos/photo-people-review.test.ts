import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('review uses a scoped repeatable snapshot and never exposes biometric prototypes', async () => {
  let sql = '';
  let where: unknown;
  const service = new PhotoManagementService({
    $transaction: async (run: (tx: unknown) => unknown, options: unknown) => {
      assert.deepEqual(options, { isolationLevel: 'RepeatableRead' });
      return run({
        $queryRaw: async (query: { text: string; values: unknown[] }) => {
          sql = query.text;
          assert.ok(query.values.includes('owner'));
          return [{ firstId: 'a', secondId: 'b', firstCount: 30n, secondCount: 20n, similarity: 0.4 }];
        },
        eaglePhotoPerson: { findMany: async (query: {where: unknown}) => {
          where = query.where;
          return ['a', 'b'].map(id => ({ id, prototype: [1], name: null, faces: [] }));
        } },
      });
    },
  } as never);
  const result = await service.reviewPeople('owner', false);
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]?.first.photoCount, 30);
  assert.equal('prototype' in result.pairs[0]!.first, false);
  assert.match(sql, /"mediaRevision"/);
  assert.match(sql, /"isPrivate" = false/);
  assert.match(sql, /"libraryMode" = 'PHOTO'/);
  assert.match(sql, /count\(DISTINCT/);
  assert.match(sql, /NOT EXISTS/);
  assert.match(sql, /LIMIT 400/);
  assert.match(sql, /LIMIT 100/);
  assert.deepEqual(where, { ownerId: 'owner', libraryMode: 'PHOTO', id: { in: ['a', 'b'] }, marksAssetsPrivate: false });
});
