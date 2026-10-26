import assert from 'node:assert/strict';
import test from 'node:test';
import {
  queuePhotoFaceScan,
  unscannedPhotoFacesSql,
  PHOTO_FACE_MODEL_VERSION,
} from './photo-face-scan';

test('coverage and enqueue use one versioned, scoped preview predicate', () => {
  for (const privateAccess of [false, true]) {
    const query = unscannedPhotoFacesSql('owner', privateAccess);
    assert.ok(query.values.includes('owner'));
    assert.ok(query.values.includes(privateAccess));
    assert.ok(query.values.includes(PHOTO_FACE_MODEL_VERSION));
    for (const clause of [
      '"deletedAt" IS NULL',
      '"lifecycleStatus"=\'READY\'',
      '"mediaRevision"',
      '"isPrivate"',
      "r.variant='default'",
      'NOT EXISTS',
      '"ownerId"',
      "'PHOTO'",
    ])
      assert.ok(query.sql.includes(clause));
    assert.doesNotMatch(query.sql, /LIMIT|INTERACTIVE/);
  }
});
test('empty scans return an honest zero receipt in a bounded transaction', async () => {
  const seen: string[] = [];
  const db = {
    $transaction: async (fn: (tx: unknown) => unknown, options: unknown) => {
      assert.deepEqual(options, { maxWait: 5000, timeout: 30000 });
      return fn({
        $executeRaw: async (sql: { sql: string }) => {
          seen.push(sql.sql);
          return 0;
        },
        $queryRaw: async (sql: { sql: string }) => {
          seen.push(sql.sql);
          return [];
        },
      });
    },
  };
  assert.deepEqual(await queuePhotoFaceScan(db as never, 'owner', false), {
    queued: 0,
    scanned: 0,
    limit: null,
  });
  assert.match(seen[0]!, /statement_timeout/);
  assert.match(seen[1]!, /pg_advisory_xact_lock/);
  assert.match(seen[2]!, /INSERT INTO/);
});
test('enqueue failures propagate instead of reporting a partial scan as complete', async () => {
  const db = {
    $transaction: async () => {
      throw new Error('statement timeout');
    },
  };
  await assert.rejects(queuePhotoFaceScan(db as never, 'owner', false), /statement timeout/);
});
