import assert from 'node:assert/strict';
import test from 'node:test';
import { SmartFolderBuildRunner } from './smart-folder-runner';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('committed batches release and reacquire the maintenance grant promptly, then stop spinning when complete', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  const order: string[] = [];
  let steps = 0;
  const runner = new SmartFolderBuildRunner(
    async (run) => {
      order.push('grant');
      await run(true);
      order.push('release');
    },
    async (allow) => {
      assert.equal(allow, true);
      order.push('step');
      return ++steps === 1;
    },
    (error) => assert.fail(String(error)),
  );
  try {
    runner.wake();
    await flush();
    assert.deepEqual(order, ['grant', 'step', 'release']);
    t.mock.timers.tick(99);
    await flush();
    assert.equal(steps, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(steps, 2);
    assert.deepEqual(order, ['grant', 'step', 'release', 'grant', 'step', 'release']);
    t.mock.timers.tick(4999);
    await flush();
    assert.equal(steps, 2);
    runner.stop();
    t.mock.timers.tick(10000);
    await flush();
    assert.equal(steps, 2);
  } finally {
    runner.stop();
  }
});
test('a denied maintenance grant never spins or bypasses model eligibility', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let grants = 0,
    steps = 0;
  const runner = new SmartFolderBuildRunner(
    async (run) => {
      if (++grants > 1) await run(false);
    },
    async (allow) => {
      steps++;
      assert.equal(allow, false);
      return false;
    },
    (error) => assert.fail(String(error)),
  );
  try {
    runner.wake();
    await flush();
    assert.equal(steps, 0);
    t.mock.timers.tick(4999);
    await flush();
    assert.equal(grants, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(steps, 1);
  } finally {
    runner.stop();
  }
});

test('unexpected failures back off for thirty seconds without a busy retry loop', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100000 });
  let attempts = 0;
  const errors: unknown[] = [];
  const runner = new SmartFolderBuildRunner(
    async () => {
      attempts++;
      throw new Error('database unavailable');
    },
    async () => false,
    (error) => errors.push(error),
  );
  try {
    runner.wake();
    await flush();
    assert.equal(attempts, 1);
    assert.equal(errors.length, 1);
    t.mock.timers.tick(29999);
    await flush();
    assert.equal(attempts, 1);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(attempts, 2);
  } finally {
    runner.stop();
  }
});
