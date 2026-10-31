import { expect, it } from 'vitest';
import { EagleOperationChanges } from './eagle-operation-changes';

it('hides a pending deletion immediately, preserves trash membership, and restores only failures', () => {
  const changes = new EagleOperationChanges();
  changes.begin('delete', 'TRASH', ['a', 'b', 'a']);
  expect(changes.visible('a', false)).toBe(false);
  expect(changes.visible('a', true)).toBe(true);
  changes.finish('delete', 'TRASH', [
    { assetIds: ['a'], status: 'COMPLETED', errorCode: null },
    { assetIds: ['b'], status: 'FAILED', errorCode: 'ASSET_CHANGED' },
  ]);
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
  changes.finish('old', 'TRASH', [{ assetIds: ['a'], status: 'COMPLETED', errorCode: null }]);
  changes.begin('restore', 'RESTORE', ['a']);
  expect(changes.visible('a', true)).toBe(false);
  changes.finish('restore', 'RESTORE', [{ assetIds: ['a'], status: 'COMPLETED', errorCode: null }]);
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
