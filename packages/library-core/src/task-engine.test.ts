import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideTask,
  taskGroupPresentation,
  resolveTaskPresentation,
  taskBucketDecision,
  taskModelReadiness,
  workerSupportsTask,
} from './task-engine';
import {mediaTaskBlocksAssetReady, type TaskGroup} from './task-scheduling';
import {mediaClaimTransition, MEDIA_LEASE_MS, mediaCompletion, mediaFailure, mediaWaitData} from './media-task-lifecycle';
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
  const claim = mediaClaimTransition(pending, now);
  assert.equal(claim?.kind, 'CLAIM');
  assert.equal(claim.kind === 'CLAIM' && claim.data.leaseVersion.increment, 1);
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
  assert.equal(recovered?.kind, 'CLAIM');
  assert.equal(recovered.kind === 'CLAIM' && recovered.recovery, true);
  assert.equal(recovered.kind === 'CLAIM' && recovered.data.startedAt, now);
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
  assert.equal(mediaClaimTransition(state, now)?.kind, 'EXHAUSTED');
});

test('completion and failure use one fenced execution identity and one retry budget', () => {
  const job = {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO' as const,
    assetId: 'asset',
    assetRevision: 4,
    leaseVersion: 7,
    attempts: 2,
    kind: 'GENERATE_EMBEDDING',
  };
  assert.deepEqual(mediaCompletion(job, now).where, {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    assetId: 'asset',
    assetRevision: 4,
    leaseVersion: 7,
    status: 'PROCESSING',
  });
  const retry = mediaFailure(job, 'transient', false, now);
  assert.equal(retry.terminal, false);
  assert.equal(retry.data.status, 'PENDING');
  assert.equal(mediaFailure({ ...job, attempts: 12 }, 'timeout', false, now).terminal, true);
  assert.equal(mediaFailure(job, 'invalid bytes', true, now).terminal, true);
  assert.equal(mediaWaitData(2, 30000, 'WAITING_MODEL', now).attempts, 1);
});

const worker = {
  background: true,
  jobKinds: null,
  video: true,
  tagBuilds: true,
  smartFolders: true,
  photoMap: true,
  embedding: 'READY' as const,
};
test('capabilities distinguish disabled resources from unknown rolling-upgrade workers', () => {
  assert.equal(workerSupportsTask(null, 'EMBEDDING', 'GENERATE_EMBEDDING'), true);
  assert.equal(workerSupportsTask({}, 'EMBEDDING', 'GENERATE_EMBEDDING'), true);
  assert.equal(
    workerSupportsTask({ ...worker, background: false }, 'EMBEDDING', 'GENERATE_EMBEDDING'),
    false,
  );
  assert.equal(workerSupportsTask({ ...worker, video: false }, 'VIDEO', 'GENERATE_PREVIEW'), false);
  assert.equal(workerSupportsTask(worker, 'SMART_FOLDERS', 'SMART_FOLDER_QUERY'), true);
  assert.equal(
    workerSupportsTask({ ...worker, tagBuilds: false }, 'TAG_INDEX', 'TAG_INDEX'),
    false,
  );
  assert.equal(workerSupportsTask(worker, 'PHOTO_MAP', 'PHOTO_MAP'), true);
  assert.equal(workerSupportsTask({ ...worker, jobKinds: [] }, 'CLEANUP', 'OBJECT_DELETION'), true);
  assert.equal(
    workerSupportsTask({ ...worker, jobKinds: [] }, 'EMBEDDING', 'GENERATE_EMBEDDING'),
    false,
  );
  assert.equal(
    taskModelReadiness(
      [worker, { ...worker, embedding: 'OFFLINE' }],
      'EMBEDDING',
      'GENERATE_EMBEDDING',
    ),
    'READY',
  );
  assert.equal(
    taskModelReadiness(
      [null, { ...worker, embedding: 'OFFLINE' }],
      'EMBEDDING',
      'GENERATE_EMBEDDING',
    ),
    'UNKNOWN',
  );
  assert.equal(
    taskModelReadiness([{ ...worker, embedding: 'DRIFTED' }], 'EMBEDDING', 'GENERATE_EMBEDDING'),
    'DRIFTED',
  );
  assert.equal(
    taskModelReadiness([{ ...worker, embedding: 'OFFLINE' }], 'EMBEDDING', 'GENERATE_EMBEDDING'),
    'OFFLINE',
  );
  assert.equal(taskModelReadiness([], 'EMBEDDING', 'GENERATE_EMBEDDING'), 'UNKNOWN');
});
test('source adapters supply facts and reuse the same model, policy and schedule decisions', () => {
  const input = {
    family: 'EMBEDDING' as const,
    step: 'GENERATE_EMBEDDING',
    reason: 'QUEUED' as const,
    nextAt: null,
    approval: false,
    paused: false,
    workers: [worker],
    schedule,
    now,
  };
  assert.equal(taskBucketDecision(input).runnable, true);
  assert.equal(taskBucketDecision({ ...input, workers: [] }).reason, 'WORKER_OFFLINE');
  assert.equal(taskBucketDecision({ ...input, paused: true }).reason, 'PAUSED');
  assert.equal(
    taskBucketDecision({ ...input, schedule: { ...schedule, mode: 'MANUAL' } }).reason,
    'PAUSED',
  );
  assert.equal(
    taskBucketDecision({ ...input, workers: [{ ...worker, embedding: 'DRIFTED' }] }).reason,
    'MODEL_DRIFTED',
  );
  assert.equal(
    taskBucketDecision({ ...input, workers: [{ ...worker, embedding: 'OFFLINE' }] }).reason,
    'MODEL_OFFLINE',
  );
  assert.equal(
    taskBucketDecision({ ...input, workers: [{ ...worker, jobKinds: [] }] }).reason,
    'DISABLED',
  );
  assert.equal(
    taskBucketDecision({ ...input, reason: 'DEPENDENCY_FAILED' }).reason,
    'DEPENDENCY_FAILED',
  );
  assert.equal(taskBucketDecision({ ...input, reason: 'DEPENDENCY' }).reason, 'DEPENDENCY');
  assert.equal(
    taskBucketDecision({ ...input, reason: 'RETRY', nextAt: now.toISOString() }).nextAt,
    now.toISOString(),
  );
  const scheduled = taskBucketDecision({ ...input, schedule: { ...schedule, mode: 'NIGHT' } });
  assert.equal(scheduled.reason, 'SCHEDULE');
  assert.equal(scheduled.nextAt, '2026-10-26T15:00:00.000Z');
  assert.equal(
    taskBucketDecision({
      ...input,
      family: 'SMART_FOLDERS',
      step: 'SMART_FOLDERS',
      workers: [{ ...worker, embedding: 'OFFLINE' }],
    }).runnable,
    true,
  );
  assert.equal(
    taskBucketDecision({
      ...input,
      family: 'SMART_FOLDERS',
      step: 'SMART_FOLDER_QUERY',
      workers: [{ ...worker, embedding: 'OFFLINE' }],
    }).reason,
    'MODEL_OFFLINE',
  );
  assert.equal(
    taskBucketDecision({ ...input, family: 'APPROVALS', approval: true, workers: [] }).reason,
    'APPROVAL',
  );
});
test('presentation reflects paused draining and model recovery without trusting browser recomputation', () => {
  assert.equal(
    taskGroupPresentation({ ...group, policy: { paused: true, priority: 0 } }, schedule).status,
    'STOPPED',
  );
  assert.equal(
    taskGroupPresentation({ ...group, running: 1, policy: { paused: true, priority: 0 } }, schedule)
      .status,
    'RUNNING',
  );
  assert.equal(
    taskGroupPresentation({ ...group, running: 1 }, schedule, 'OFFLINE').reason,
    'MODEL_OFFLINE',
  );
  assert.equal(taskGroupPresentation(group, schedule, 'DRIFTED').reason, 'MODEL_DRIFTED');
  assert.equal(
    resolveTaskPresentation(
      { ...group, presentation: { status: 'STOPPED', section: 'PAUSED', reason: 'PAUSED' } },
      schedule,
    ).section,
    'PAUSED',
  );
  const job = {
    id: 'job',
    ownerId: 'owner',
    libraryMode: 'PHOTO' as const,
    assetId: 'asset',
    assetRevision: 1,
    leaseVersion: 2,
    kind: 'RENDER_EDITED_COPY',
    attempts: 3,
  };
  assert.equal(mediaFailure(job, 'failure', false).terminal, true);
  assert.equal(mediaCompletion(job).data.status, 'COMPLETED');
  assert.equal(mediaWaitData(0, 1000, 'WAIT').attempts, 0);
});

test('primary blocking reason follows the shared precedence rather than bucket arrival order', () => {
  const waiting = [
    { reason: 'DEPENDENCY' as const, count: 2, nextAt: null },
    { reason: 'MODEL_OFFLINE' as const, count: 1, nextAt: null },
  ];
  assert.equal(taskGroupPresentation({ ...group, waiting }, schedule).reason, 'MODEL_OFFLINE');
  assert.equal(
    taskGroupPresentation({ ...group, waiting: [...waiting].reverse() }, schedule).reason,
    'MODEL_OFFLINE',
  );
});

test('an idle paused group keeps its pause reason even while its model is offline', () => {
  assert.equal(
    taskGroupPresentation({ ...group, policy: { paused: true, priority: 0 } }, schedule, 'OFFLINE')
      .status,
    'STOPPED',
  );
  assert.equal(
    taskGroupPresentation(
      { ...group, running: 1, policy: { paused: true, priority: 0 } },
      schedule,
      'OFFLINE',
    ).status,
    'WAITING',
  );
  assert.equal(
    taskGroupPresentation({ ...group, running: 1 }, schedule, 'READY', 'OFFLINE').reason,
    'WORKER_OFFLINE',
  );
});

test('retrying an edited copy never turns its ready source back into processing', () => {
  assert.equal(mediaTaskBlocksAssetReady('RENDER_EDITED_COPY', 'v1'), false);
  assert.equal(mediaTaskBlocksAssetReady('GENERATE_THUMBNAIL', 'v1'), true);
  assert.equal(mediaTaskBlocksAssetReady('GENERATE_RENDITIONS', 'photo-source-details-v1'), false);
  assert.equal(mediaTaskBlocksAssetReady('GENERATE_PREVIEW', 'camera-video-playback-v1'), false);
});
