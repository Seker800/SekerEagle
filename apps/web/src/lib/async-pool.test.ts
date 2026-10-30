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

it('preserves input order and bounds invalid or fractional concurrency', async () => {
  expect(await mapWithConcurrency([], 2, async () => 0)).toEqual([]);
  for (const limit of [Number.NaN, 0, 1.9, 2]) {
    let active = 0,
      max = 0;
    const result = await mapWithConcurrency([1, 2, 3], limit, async (item, index) => {
      max = Math.max(max, ++active);
      await Promise.resolve();
      active--;
      return item + index;
    });
    expect(result).toEqual([1, 3, 5]);
    expect(max).toBeLessThanOrEqual(limit === 2 ? 2 : 1);
  }
});
it('keeps the first failure when both already-running workers reject', async () => {
  const work = mapWithConcurrency([0, 1, 2], 2, async (item) => {
    throw new Error(`failed-${item}`);
  });
  await expect(work).rejects.toMatchObject({
    message: 'failed-0',
    completed: [],
    retryItems: [0, 1, 2],
  });
});
