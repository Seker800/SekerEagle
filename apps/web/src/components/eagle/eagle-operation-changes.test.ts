import { expect, it } from 'vitest';
import { EagleOperationChanges } from './eagle-operation-changes';

it('hides a pending deletion immediately, preserves trash membership, and restores only failures', () => {
  const changes = new EagleOperationChanges();
  changes.begin('delete', 'TRASH', ['a', 'b', 'a']);
  expect(changes.visible('a', false)).toBe(false);
  expect(changes.visible('a', true)).toBe(true);
  changes.finish(
    'delete',
    'TRASH',
    [
      { assetIds: ['a'], status: 'COMPLETED', errorCode: null },
      { assetIds: ['b'], status: 'FAILED', errorCode: 'ASSET_CHANGED' },
    ],
    undefined,
    [
      { id: 'a', rowVersion: 2, state: 'TRASH' },
      { id: 'b', rowVersion: 1, state: 'ACTIVE' },
    ],
  );
  expect(changes.visible('a', false)).toBe(false);
  expect(changes.visible('b', false)).toBe(true);
  expect(changes.entries[0]?.failedIds).toEqual(['b']);
});
it('keeps unconfirmed submissions pending and rolls back a definite rejection', () => {
  const changes = new EagleOperationChanges();
  changes.begin('delete', 'TRASH', ['a']);
  changes.uncertain('delete', 'Network timeout');
  expect(changes.hasPending()).toBe(true);
  expect(changes.visible('a', false)).toBe(false);
  changes.reject('delete', 'Forbidden');
  expect(changes.visible('a', false)).toBe(true);
  expect(changes.hasPending()).toBe(false);
});
it('applies restore receipts without overwriting newer pending intent and retains facts after dismissal', () => {
  const changes = new EagleOperationChanges();
  changes.finish(
    'old',
    'TRASH',
    [{ assetIds: ['a'], status: 'COMPLETED', errorCode: null }],
    undefined,
    [{ id: 'a', rowVersion: 2, state: 'TRASH' }],
  );
  changes.begin('restore', 'RESTORE', ['a']);
  expect(changes.visible('a', true)).toBe(false);
  changes.finish(
    'restore',
    'RESTORE',
    [{ assetIds: ['a'], status: 'COMPLETED', errorCode: null }],
    undefined,
    [{ id: 'a', rowVersion: 3, state: 'ACTIVE' }],
  );
  expect(changes.visible('a', false)).toBe(true);
  expect(changes.visible('a', true)).toBe(false);
  changes.dismiss('restore');
  expect(changes.visible('a', true)).toBe(false);
  changes.clear();
  expect(changes.visible('a', true)).toBe(true);
});
it('never optimistically hides sending sources or changes failed cleanup members', () => {
  const changes = new EagleOperationChanges();
  changes.begin('send', 'SEND', ['a']);
  expect(changes.visible('a', false)).toBe(true);
  changes.finish('cleanup', 'DUPLICATE_CLEANUP', [
    { assetIds: ['b'], status: 'FAILED', errorCode: 'ASSET_CHANGED' },
  ]);
  expect(changes.visible('b', false)).toBe(true);
});

it('rejects stale deletion receipts after restore and accepts newer server membership', () => {
  const changes = new EagleOperationChanges();
  changes.finish(
    'restore',
    'RESTORE',
    [
      {
        assetIds: ['a'],
        status: 'COMPLETED',
        errorCode: null,
      },
    ],
    undefined,
    [{ id: 'a', rowVersion: 3, state: 'ACTIVE' }],
  );
  changes.finish(
    'old-delete',
    'TRASH',
    [
      {
        assetIds: ['a'],
        status: 'COMPLETED',
        errorCode: null,
      },
    ],
    undefined,
    [{ id: 'a', rowVersion: 2, state: 'TRASH' }],
  );
  expect(changes.visible('a', false)).toBe(true);
  changes.observePage([{ id: 'a', rowVersion: 2 }], true);
  expect(changes.visible('a', false)).toBe(true);
  changes.observePage([{ id: 'a', rowVersion: 4 }], true);
  expect(changes.visible('a', false)).toBe(false);
});

it('ignores a late admission acknowledgment once terminal results have been applied', () => {
  const changes = new EagleOperationChanges();
  changes.begin('delete', 'TRASH', ['a']);
  changes.finish('delete', 'TRASH', [{ assetIds: ['a'], status: 'COMPLETED', errorCode: null }], {
    id: 'delete',
    kind: 'TRASH',
    libraryMode: 'PHOTO',
    total: 1,
    completed: 1,
    queued: 0,
    running: 0,
    failed: 0,
    cancelled: 0,
    state: 'COMPLETED',
    errors: [],
  });
  changes.observe({
    id: 'delete',
    kind: 'TRASH',
    libraryMode: 'PHOTO',
    total: 1,
    completed: 0,
    queued: 1,
    running: 0,
    failed: 0,
    cancelled: 0,
    state: 'QUEUED',
    errors: [],
  });
  expect(changes.entries[0]?.summary?.completed).toBe(1);
  expect(changes.entries[0]?.pending).toBe(false);
});

it('expands visible live-photo companions without changing the idempotent request selection', () => {
  const changes = new EagleOperationChanges();
  changes.begin('delete', 'TRASH', ['still']);
  changes.expand('delete', ['motion']);
  expect(changes.visible('motion', false)).toBe(false);
  expect(changes.entries[0]?.requestAssetIds).toEqual(['still']);
  expect(changes.entries[0]?.assetIds).toEqual(['still', 'motion']);
});

it('does not resurrect unavailable resources from a stale page but accepts a fresh authorized observation', () => {
  const changes = new EagleOperationChanges();
  const started = changes.getSnapshot();
  changes.finish('delete', 'TRASH', [], undefined, [
    { id: 'a', rowVersion: null, state: 'UNAVAILABLE' },
  ]);
  changes.observePage([{ id: 'a', rowVersion: 4 }], false, started);
  expect(changes.visible('a', false)).toBe(false);
  changes.observePage([{ id: 'a', rowVersion: 4 }], false, changes.getSnapshot());
  expect(changes.visible('a', false)).toBe(true);
});
