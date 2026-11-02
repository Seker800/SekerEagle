import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleTaskCenterController } from './eagle-task-center.controller';

test('task family scans and retries persist intent without entering synchronous reconciliation', async () => {
  const calls: unknown[][] = [];
  const receipt = { id: 'intent', state: 'QUEUED' };
  const blocked = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('HTTP entered task execution');
      },
    },
  );
  const c = new EagleTaskCenterController(
    blocked as never,
    {} as never,
    {
      enqueueCommand: async (...args: unknown[]) => {
        calls.push(args);
        return receipt;
      },
    } as never,
  );
  const principal = { sub: 'owner', canViewPrivate: false } as never;
  assert.equal(await c.start(principal, { family: 'FACES' }), receipt);
  assert.equal(await c.retry(principal, { family: 'FACES' }), receipt);
  assert.deepEqual(calls[0], [principal, { type: 'PHOTO_PEOPLE_SCAN', payload: {} }]);
  assert.deepEqual(calls[1], [
    principal,
    { type: 'TASK_FAMILY_RETRY', payload: { family: 'FACES' } },
  ]);
});

test('task retry shares engine publication transaction and validates its family', async () => {
  const { LibraryCommandRegistry } = await import('./eagle-library-command');
  const { registerTaskCommands } = await import('./eagle-task-commands');
  const calls: unknown[][] = [];
  const registry = new LibraryCommandRegistry();
  registerTaskCommands(registry, {
    retry: async (...args: unknown[]) => {
      calls.push(args);
    },
  } as never);
  const definition = registry.get('TASK_FAMILY_RETRY');
  const context = {
    operationId: 'intent',
    ownerId: 'owner',
    libraryMode: 'PHOTO' as const,
    includePrivate: false,
    beforePublish: async () => {},
  };
  await assert.rejects(
    async () => definition.admit!(context, { family: 'FOREIGN' }, []),
    /类别无效/,
  );
  if (definition.protocol !== 'METADATA') assert.fail('retry must use metadata publication');
  const tx = {} as never;
  await definition.apply(tx, context, { family: 'FACES' }, []);
  assert.deepEqual(calls, [['owner', 'FACES', false, tx]]);
});
