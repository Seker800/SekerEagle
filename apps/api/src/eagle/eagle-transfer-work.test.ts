import assert from 'node:assert/strict';
import test from 'node:test';
import { runTransferWork } from './eagle-transfer-work';

test('transfer work overlaps independent copies with a hard limit of four', async () => {
  let active = 0,
    peak = 0;
  const seen: number[] = [];
  await runTransferWork(
    Array.from({ length: 11 }, (_, i) => i),
    async (item) => {
      active++;
      peak = Math.max(active, peak);
      await new Promise((resolve) => setImmediate(resolve));
      seen.push(item);
      active--;
    },
  );
  assert.equal(peak, 4);
  assert.equal(active, 0);
  assert.deepEqual(
    seen.sort((a, b) => a - b),
    Array.from({ length: 11 }, (_, i) => i),
  );
});

test('a failed copy stops new work and drains in-flight writes before rejecting', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: number[] = [];
  let settled = false;
  const failure = new Error('synthetic-copy-failure');
  const result = runTransferWork([0, 1, 2, 3, 4, 5], async (item) => {
    started.push(item);
    if (item === 0) throw failure;
    await wait;
  });
  const rejection = assert
    .rejects(result, (error) => error === failure)
    .then(() => {
      settled = true;
    });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(started, [0, 1, 2, 3]);
  release();
  await rejection;
  assert.equal(settled, true);
  await runTransferWork([], async () => {
    assert.fail('empty batch ran work');
  });
});
