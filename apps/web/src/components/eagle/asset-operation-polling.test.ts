import { expect, it } from 'vitest';
import { createOperationPollSchedule } from './asset-operation-polling';

it('backs off unchanged work, immediately follows new progress and leaves idle work quiet', () => {
  const poll = createOperationPollSchedule();
  const running = [{ id: 'send', completed: 0, queued: 20, running: 1, failed: 0, cancelled: 0 }];
  expect(poll(running, false, 0, 0)).toBe(2000);
  expect(poll(running, false, 0, 11000)).toBe(5000);
  expect(poll(running, false, 0, 31000)).toBe(10000);
  expect(poll([{ ...running[0]!, completed: 1 }], false, 0, 32000)).toBe(2000);
  expect(poll([], false, 0, 33000)).toBe(60000);
  expect(poll([], true, 0, 34000)).toBe(2000);
  expect(poll([], true, 1, 35000)).toBe(5000);
  expect(poll([], true, 3, 36000)).toBe(20000);
});
