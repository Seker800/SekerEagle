import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetOperationBackground } from './asset-operation-background';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('operations host discovers backlog immediately, prevents local overlap and drains shutdown', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let release!: () => void;
  let recovery = 0,
    maintenance = 0;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const host = new AssetOperationBackground(
    [
      {
        recoverPendingFinalizations: async () => {
          recovery++;
          await wait;
        },
      },
    ],
    {
      runMaintenance: async () => {
        maintenance++;
      },
    },
    true,
  );
  host.start();
  assert.equal(recovery, 1);
  assert.equal(maintenance, 1);
  t.mock.timers.tick(600_000);
  assert.equal(recovery, 1);
  let closed = false;
  const closing = host.close().then(() => {
    closed = true;
  });
  await turn();
  assert.equal(closed, false);
  release();
  await closing;
  t.mock.timers.tick(600_000);
  assert.equal(recovery, 1);
});

test('operations host retains recovery pause and retries maintenance after errors or restart', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let attempts = 0;
  const maintenance = {
    runMaintenance: async () => {
      attempts++;
      if (attempts === 1) throw new Error('synthetic');
    },
  };
  const host = new AssetOperationBackground(
    [{ recoverPendingFinalizations: async () => assert.fail('recovery paused') }],
    maintenance,
    false,
  );
  host.start();
  await turn();
  t.mock.timers.tick(600_000);
  await turn();
  assert.equal(attempts, 2);
  await host.close();
  const restarted = new AssetOperationBackground([], maintenance, false);
  restarted.start();
  await restarted.close();
  assert.equal(attempts, 3);
});
