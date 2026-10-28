import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { ObjectDeletionRunner } from './object-deletion-runner';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(due: number[]) {
  const pending = due.map((time, index) => ({
    id: String(index),
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    objectKeys: [`users/owner/${index}`],
    prefixes: [],
    attempts: 1,
    leaseVersion: 1,
    availableAt: new Date(time),
  }));
  let claims = 0;
  const settled: string[] = [];
  const db = {
    $queryRaw: async (query: Prisma.Sql) => {
      if (query.sql.includes('UPDATE "EagleObjectDeletion"')) {
        claims++;
        const rows = pending.filter((row) => row.availableAt.getTime() <= Date.now()).slice(0, 4);
        for (const row of rows) pending.splice(pending.indexOf(row), 1);
        return rows;
      }
      return [
        {
          nextAt: pending.length
            ? new Date(Math.min(...pending.map((row) => row.availableAt.getTime())))
            : null,
        },
      ];
    },
    eagleObjectDeletion: {
      deleteMany: async ({ where }: { where: { id: string; leaseVersion: number } }) => {
        assert.equal(where.leaseVersion, 1);
        settled.push(where.id);
        return { count: 1 };
      },
      updateMany: async () => {
        assert.fail('unexpected cleanup failure');
      },
    },
  };
  return { db, settled, claims: () => claims };
}
test('cleanup wakes at a future receipt deadline and drains its following batch without a media poll', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const f = fixture([100050]);
  const deleted: string[] = [];
  const runner = new ObjectDeletionRunner(
    f.db as never,
    {
      deleteObjects: async (keys) => {
        deleted.push(...keys);
      },
      deletePrefix: async () => {},
    },
    (error) => assert.fail(String(error)),
  );
  try {
    runner.wake();
    await flush();
    assert.equal(f.claims(), 1);
    assert.equal(runner.active, false);
    t.mock.timers.tick(49);
    await flush();
    assert.equal(f.claims(), 1);
    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(deleted, ['users/owner/0']);
    assert.deepEqual(f.settled, ['0']);
    assert.equal(f.claims(), 3, 'the successful batch must trigger a drain-to-empty pass');
  } finally {
    runner.stop();
  }
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(f.claims(), 3);
});
test('cleanup is single flight and stopping drains only the current four-receipt batch', async () => {
  const f = fixture(Array(5).fill(0) as number[]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const runner = new ObjectDeletionRunner(
    f.db as never,
    {
      deleteObjects: async () => {
        requests++;
        await gate;
      },
      deletePrefix: async () => {},
    },
    (error) => assert.fail(String(error)),
  );
  runner.wake();
  await flush();
  assert.equal(requests, 4);
  assert.equal(runner.active, true);
  runner.wake();
  runner.wake();
  assert.equal(f.claims(), 1);
  runner.stop();
  release();
  await flush();
  assert.equal(runner.active, false);
  assert.equal(f.settled.length, 4);
  assert.equal(f.claims(), 1);
});
