import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceChangeState } from './workspace-change-state';

test('change tokens require a connected listener and do not reveal another owner or private writes', () => {
  const state = new WorkspaceChangeState();
  assert.throws(() => state.snapshot('owner', false));
  state.connected();
  const before = state.snapshot('owner', false);
  state.record({ ownerId: 'other', libraryMode: 'PHOTO', kinds: ['ASSETS'], public: true });
  state.record({ ownerId: 'owner', libraryMode: 'PHOTO', kinds: ['ASSETS'], public: false });
  assert.deepEqual(state.snapshot('owner', false), before);
  assert.notDeepEqual(state.snapshot('owner', true), before);
  state.record({ ownerId: 'owner', libraryMode: 'MATERIAL', kinds: ['RECOMMENDATIONS'], public: true });
  const after = state.snapshot('owner', false);
  assert.deepEqual(after.scopes.PHOTO, before.scopes.PHOTO);
  assert.notDeepEqual(after.scopes.MATERIAL, before.scopes.MATERIAL);
});

test('reconnection resets the epoch so changes committed during a gap cannot be missed', () => {
  const state = new WorkspaceChangeState();
  state.connected();
  const first = state.snapshot('owner', false);
  state.disconnected();
  assert.throws(() => state.snapshot('owner', false));
  state.connected();
  assert.notEqual(state.snapshot('owner', false).epoch, first.epoch);
});
