import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleTaskCenterController } from './eagle-task-center.controller';

test('task family scans and retries persist intent without entering synchronous reconciliation', async () => {
  const calls: unknown[][] = [];
  const receipt = { id: 'intent', state: 'QUEUED' };
  const blocked = new Proxy({}, { get: () => () => { throw new Error('HTTP entered task execution'); } });
  const c = new EagleTaskCenterController(blocked as never, {} as never, { enqueueCommand: async (...args: unknown[]) => { calls.push(args); return receipt; } } as never);
  const principal = { sub: 'owner', canViewPrivate: false } as never;
  assert.equal(await c.start(principal,{ family: 'FACES' }),receipt);
  assert.equal(await c.retry(principal,{ family: 'FACES' }),receipt);
  assert.deepEqual(calls[0],[principal,{ type: 'PHOTO_PEOPLE_SCAN', payload: {} }]);
  assert.deepEqual(calls[1],[principal,{ type: 'TASK_FAMILY_RETRY', payload: { family: 'FACES' } }]);
});
