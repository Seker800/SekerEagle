import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthController } from './health.controller';

function controllerWith(readiness: () => Promise<void>) {
  let databaseCalls = 0;
  const prisma = {
    $queryRaw: async () => {
      databaseCalls++;
      return [];
    },
  };
  const storage = { assertReady: readiness };
  return {
    controller: new HealthController(prisma as never, storage as never),
    databaseCalls: () => databaseCalls,
  };
}

test('readiness collapses concurrent probes into one database and storage check', async () => {
  let storageCalls = 0;
  const { controller, databaseCalls } = controllerWith(async () => {
    storageCalls++;
  });
  const [first, second] = await Promise.all([controller.getReadiness(), controller.getReadiness()]);
  assert.deepEqual(first, { status: 'ready' });
  assert.deepEqual(second, { status: 'ready' });
  assert.equal(databaseCalls(), 1);
  assert.equal(storageCalls, 1);
});

test('a failed readiness probe is not cached', async () => {
  let fail = true;
  const { controller } = controllerWith(async () => {
    if (fail) throw new Error('storage unavailable');
  });
  await assert.rejects(controller.getReadiness());
  fail = false;
  await assert.doesNotReject(controller.getReadiness());
});
