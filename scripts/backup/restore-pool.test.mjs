import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('restore pool processes every object once with bounded active uploads', async () => {
  const { runRestorePool } = await import('./restore-pool.mjs');
  let active = 0;
  let peak = 0;
  const seen = [];
  const progress = [];
  await runRestorePool(Array.from({ length: 25 }, (_, i) => i), async (item) => {
    active++;
    peak = Math.max(active, peak);
    await delay(1);
    seen.push(item);
    active--;
  }, { concurrency: 4, onProgress: (count) => progress.push(count) });
  assert.equal(peak, 4);
  assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
  assert.deepEqual(progress, Array.from({ length: 25 }, (_, i) => i + 1));
});

test('first restore failure stops scheduling and waits for active writes before rejecting', async () => {
  const { runRestorePool } = await import('./restore-pool.mjs');
  const started = [];
  const finished = [];
  const failure = new Error('corrupt object');
  await assert.rejects(runRestorePool([0, 1, 2, 3, 4, 5], async (item) => {
    started.push(item);
    if (item === 0) throw failure;
    await delay(5);
    finished.push(item);
  }, { concurrency: 2 }), (error) => error === failure);
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(finished, [1]);
});

test('empty restores succeed and invalid concurrency never starts an upload', async () => {
  const { runRestorePool } = await import('./restore-pool.mjs');
  await runRestorePool([], () => assert.fail('empty queue'));
  for (const concurrency of [0, -1, 9, 1.5, Number.NaN]) {
    await assert.rejects(runRestorePool([1], () => assert.fail('invalid pool'), { concurrency }), /concurrency/u);
  }
});
