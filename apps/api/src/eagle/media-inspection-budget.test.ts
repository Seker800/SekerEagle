import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaInspectionBudget } from './media-inspection-budget';

test('inspection budget serializes all libraries, bounds per-owner work and releases after failure', async () => {
  const budget = new MediaInspectionBudget();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = 0;
  const execute = (owner: string, fail = false) =>
    budget.run(owner, async () => {
      running++;
      assert.equal(running, 1);
      try {
        await gate;
        if (fail) throw new Error('decode failed');
        return owner;
      } finally {
        running--;
      }
    });
  const first = execute('owner-1', true).catch((error) => error.message);
  const rest = [execute('owner-1'), execute('owner-1'), execute('owner-1'), execute('owner-2')];
  await assert.rejects(execute('owner-1'), /繁忙/);
  release();
  assert.equal(await first, 'decode failed');
  assert.deepEqual(await Promise.all(rest), ['owner-1', 'owner-1', 'owner-1', 'owner-2']);
  assert.equal(await execute('owner-1'), 'owner-1');
});
