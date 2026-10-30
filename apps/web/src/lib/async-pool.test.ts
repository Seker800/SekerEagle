import { expect, it } from 'vitest';
import { mapWithConcurrency } from './async-pool';
it('stops new work on failure and drains siblings before rejecting with settled results', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const calls: number[] = [];
  let settled = false;
  const work = mapWithConcurrency([0, 1, 2], 2, async (item) => {
    calls.push(item);
    if (item === 0) throw new Error('first failed');
    await gate;
    return item;
  });
  const result = work.catch((error: unknown) => {
    settled = true;
    return error;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  expect(await result).toMatchObject({ completed: [{ item: 1, result: 1 }], retryItems: [0, 2] });
  expect(calls).toEqual([0, 1]);
});
