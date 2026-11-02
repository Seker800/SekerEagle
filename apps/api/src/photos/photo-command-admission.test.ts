import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementController } from './photo-management.controller';
import { PhotoAgentController } from './photo-agent.controller';

const principal = { sub: 'owner', canViewPrivate: false } as never;

test('photography writes acknowledge durable intent without executing blocked domain services', async () => {
  const calls: unknown[] = [];
  const queued = { id: 'operation', status: 'PENDING' };
  const operations = {
    enqueueCommand: async (...args: unknown[]) => {
      calls.push(args);
      return queued;
    },
  };
  const blocked = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('domain execution entered HTTP');
      },
    },
  );
  const controller = new PhotoManagementController(
    blocked as never,
    blocked as never,
    blocked as never,
    operations as never,
  );
  assert.equal(await controller.rename(principal, 'person', { name: 'Name' }), queued);
  assert.equal(await controller.scanGroups(principal), queued);
  assert.equal(await controller.scanPeople(principal), queued);
  assert.equal(
    await controller.privacy(principal, 'person', { marksAssetsPrivate: true, rowVersion: 2 }),
    queued,
  );
  assert.equal(
    await controller.decidePeople(principal, {
      firstId: 'first',
      secondId: 'second',
      firstVersion: 1,
      secondVersion: 1,
      decision: 'SAME',
    }),
    queued,
  );
  assert.equal(
    await controller.mergeSelected(principal, {
      targetId: 'first',
      people: [
        { id: 'first', rowVersion: 1 },
        { id: 'second', rowVersion: 1 },
      ],
    }),
    queued,
  );
  assert.equal(await controller.merge(principal, 'first', { targetId: 'second' }), queued);
  assert.equal(await controller.assign(principal, 'face', { personId: null }), queued);
  assert.equal(await controller.createGroup(principal, { assetIds: ['first', 'second'] }), queued);
  assert.equal(await controller.removeMembers(principal, 'group', { assetIds: ['first'] }), queued);
  assert.equal(await controller.mergeGroups(principal, 'first', { targetId: 'second' }), queued);
  assert.equal(await controller.group(principal, 'group', { dismissed: true }), queued);
  assert.equal(calls.length, 12);
  for (const [, input] of calls as [unknown, { type: string; assetIds?: string[] }][]) {
    assert.match(input.type, /^PHOTO_/);
    assert.equal(input.assetIds, undefined, 'person IDs must never be interpreted as asset IDs');
  }
});

test('agent review, undo and manual actions only enqueue from their authenticated browser routes', async () => {
  const calls: unknown[] = [];
  const queued = { id: 'operation', status: 'PENDING' };
  const operations = {
    enqueueCommand: async (...args: unknown[]) => {
      calls.push(args);
      return queued;
    },
  };
  const blocked = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('domain execution entered HTTP');
      },
    },
  );
  const controller = new PhotoAgentController(
    blocked as never,
    blocked as never,
    operations as never,
  );
  assert.equal(
    await controller.review(principal, 'task', 'suggestion', { action: 'ACCEPT' }),
    queued,
  );
  assert.equal(await controller.undo(principal, 'task', 'suggestion'), queued);
  assert.equal(
    await controller.reviewRequest(principal, 'task', {
      action: 'REJECT',
      suggestionIds: ['suggestion'],
    }),
    queued,
  );
  assert.equal(
    await controller.manualAction(principal, 'task', {
      operationId: 'intent',
      action: 'DELETE',
      items: [{ suggestionId: 'suggestion', mediaRevision: 1, rowVersion: 1 }],
    }),
    queued,
  );
  assert.equal(calls.length, 4);
});
