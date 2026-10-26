import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideTask,
  taskGroupPresentation,
  mediaClaimTransition,
  MEDIA_LEASE_MS,
  mediaCompletion,
  mediaFailure,
  mediaWaitData,
} from './task-engine';
import type { TaskGroup } from './task-scheduling';
const now = new Date('2026-10-26T04:00:00Z');
const ready = {
  paused: false,
  workerOffline: false,
  disabled: false,
  modelOffline: false,
  modelDrifted: false,
  dependencyFailed: false,
  dependencyPending: false,
  outsideSchedule: false,
  retryPending: false,
  approval: false,
};
test('one decision distinguishes deployment, model, dependency and time waits', () => {
  assert.deepEqual(decideTask(ready), { runnable: true, reason: 'QUEUED', nextAt: null });
  for (const [flag, reason] of Object.entries({
    paused: 'PAUSED',
    workerOffline: 'WORKER_OFFLINE',
    disabled: 'DISABLED',
    modelOffline: 'MODEL_OFFLINE',
    modelDrifted: 'MODEL_DRIFTED',
    dependencyFailed: 'DEPENDENCY_FAILED',
    dependencyPending: 'DEPENDENCY',
    outsideSchedule: 'SCHEDULE',
    retryPending: 'RETRY',
    approval: 'APPROVAL',
  })) {
    assert.equal(decideTask({ ...ready, [flag]: true }, now.toISOString()).reason, reason);
  }
  assert.equal(decideTask({ ...ready, paused: true, modelOffline: true }).reason, 'PAUSED');
  assert.equal(decideTask({ ...ready, disabled: true, outsideSchedule: true }).reason, 'DISABLED');
  assert.equal(
    decideTask({ ...ready, dependencyPending: true, retryPending: true }).reason,
    'DEPENDENCY',
  );
  assert.equal(
    decideTask({ ...ready, outsideSchedule: true }, now.toISOString()).nextAt,
    now.toISOString(),
  );
  assert.equal(decideTask({ ...ready, modelOffline: true }, now.toISOString()).nextAt, null);
});
const group: TaskGroup = {
  id: 'EMBEDDING',
  background: true,
  queued: 3,
  running: 0,
  completed: 5,
  failed: 0,
  approval: 0,
  waiting: [],
  steps: [],
};
const schedule = { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' };
test('presentation distinguishes all-blocked from mixed runnable work', () => {
  assert.equal(taskGroupPresentation(group, schedule).status, 'QUEUED');
  const blocked = {
    ...group,
    waiting: [{ reason: 'MODEL_OFFLINE' as const, count: 3, nextAt: null }],
  };
  assert.equal(taskGroupPresentation(blocked, schedule).status, 'WAITING');
  assert.equal(taskGroupPresentation({ ...blocked, running: 1 }, schedule).status, 'RUNNING');
  assert.equal(
    taskGroupPresentation(
      { ...blocked, waiting: [{ reason: 'MODEL_OFFLINE', count: 2, nextAt: null }] },
      schedule,
    ).status,
    'QUEUED',
  );
  assert.equal(
    taskGroupPresentation({ ...group, queued: 0, failed: 2 }, schedule).status,
    'STOPPED',
  );
  assert.equal(taskGroupPresentation({ ...group, queued: 0 }, schedule).status, 'COMPLETED');
  assert.equal(
    taskGroupPresentation({ ...group, id: 'APPROVALS', queued: 0, approval: 1 }, schedule).status,
    'WAITING',
  );
});
test('claim rejects terminal, future, live and corrupt leases at the shared expiry boundary', () => {
  const pending = {
    status: 'PENDING',
    availableAt: now,
    lockedAt: null,
    startedAt: null,
    attempts: 0,
    leaseVersion: 2,
    recoveryCount: 0,
  };
  assert.equal(mediaClaimTransition(pending, now)?.data.leaseVersion.increment, 1);
  assert.equal(
    mediaClaimTransition({ ...pending, availableAt: new Date(now.getTime() + 1) }, now),
    null,
  );
  assert.equal(mediaClaimTransition({ ...pending, status: 'FAILED' }, now), null);
  assert.equal(mediaClaimTransition({ ...pending, status: 'COMPLETED' }, now), null);
  assert.equal(mediaClaimTransition({ ...pending, status: 'PROCESSING' }, now), null);
  const edge = new Date(now.getTime() - MEDIA_LEASE_MS);
  assert.equal(
    mediaClaimTransition({ ...pending, status: 'PROCESSING', lockedAt: edge }, now),
    null,
  );
  const recovered = mediaClaimTransition(
    { ...pending, status: 'PROCESSING', lockedAt: new Date(edge.getTime() - 1) },
    now,
  );
  assert.equal(recovered?.recovery, true);
  assert.equal(recovered?.data.startedAt, now);
});

test('expired executions have a finite recovery budget separate from model wait attempts', () => {
  const state = {
    status: 'PROCESSING',
    availableAt: now,
    lockedAt: new Date(now.getTime() - MEDIA_LEASE_MS - 1),
    startedAt: now,
    attempts: 1,
    leaseVersion: 5,
    recoveryCount: 3,
  };
  assert.equal(mediaClaimTransition(state, now)?.exhausted, true);
});


test('completion and failure use one fenced execution identity and one retry budget', () => {
  const job = {id: 'job', ownerId: 'owner', libraryMode: 'PHOTO' as const, assetId: 'asset', assetRevision: 4, leaseVersion: 7, attempts: 2, kind: 'GENERATE_EMBEDDING'};
  assert.deepEqual(mediaCompletion(job, now).where, {id: 'job', ownerId: 'owner', libraryMode: 'PHOTO', assetId: 'asset', assetRevision: 4, leaseVersion: 7, status: 'PROCESSING'});
  const retry = mediaFailure(job, 'transient', false, now);
  assert.equal(retry.terminal, false);
  assert.equal(retry.data.status, 'PENDING');
  assert.equal(mediaFailure({...job, attempts: 12}, 'timeout', false, now).terminal, true);
  assert.equal(mediaFailure(job, 'invalid bytes', true, now).terminal, true);
  assert.equal(mediaWaitData(2, 30000, 'WAITING_MODEL', now).attempts, 1);
});
