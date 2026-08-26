import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideFailure,
  selectCompletedJobIdsToPrune,
  selectConnectivityRetryJobIds,
  selectRunnableJobs,
} from '../src/queue-policy.js';

test('pauses authentication failures, rejects permanent inputs, and backs off transient failures', () => {
  assert.deepEqual(decideFailure({ kind: 'AUTH' }, 1, 1_000), {
    status: 'PAUSED_AUTH',
    nextAttemptAt: null,
  });
  assert.deepEqual(decideFailure({ kind: 'PERMANENT' }, 1, 1_000), {
    status: 'FAILED',
    nextAttemptAt: null,
  });
  assert.deepEqual(
    decideFailure({ kind: 'TRANSIENT' }, 2, 1_000, () => 0),
    {
      status: 'RETRY',
      nextAttemptAt: 3_000,
    },
  );
});

test('selects only due jobs in stable capture order and respects concurrency', () => {
  const jobs = [
    { id: 'later', status: 'RETRY', nextAttemptAt: 2_000, createdAt: 2 },
    { id: 'first', status: 'PENDING', nextAttemptAt: null, createdAt: 1 },
    { id: 'done', status: 'COMPLETED', nextAttemptAt: null, createdAt: 0 },
    { id: 'second', status: 'RETRY', nextAttemptAt: 900, createdAt: 3 },
  ];

  assert.deepEqual(
    selectRunnableJobs(jobs, 1_000, 2).map(({ id }) => id),
    ['first', 'second'],
  );
});

test('selects only server-side transient retries after connectivity is restored', () => {
  const jobs = [
    { id: 'successful', status: 'COMPLETED', lastFailureStage: null },
    { id: 'source', status: 'RETRY', lastFailureStage: 'SOURCE_DOWNLOAD' },
    { id: 'server', status: 'RETRY', lastFailureStage: 'SERVER_CONNECT' },
    { id: 'upload', status: 'RETRY', lastFailureStage: 'UPLOAD' },
    { id: 'commit', status: 'RETRY', lastFailureStage: 'COMMIT' },
    { id: 'legacy-upload', status: 'RETRY', blob: new Blob(['queued']) },
    { id: 'legacy-source', status: 'RETRY', blob: null },
    { id: 'terminal', status: 'FAILED', lastFailureStage: 'UPLOAD' },
  ];

  assert.deepEqual(selectConnectivityRetryJobIds(jobs, 'successful'), [
    'server',
    'upload',
    'commit',
    'legacy-upload',
  ]);
});

test('bounds completed history without ever pruning pending or failed work', () => {
  const jobs = [
    { id: 'pending', status: 'PENDING', completedAt: null },
    { id: 'failed', status: 'FAILED', completedAt: null },
    { id: 'newest', status: 'COMPLETED', completedAt: 10_000 },
    { id: 'middle', status: 'COMPLETED', completedAt: 9_000 },
    { id: 'old', status: 'COMPLETED', completedAt: 1_000 },
  ];

  assert.deepEqual(selectCompletedJobIdsToPrune(jobs, 11_000, { maxEntries: 2, maxAgeMs: 5_000 }), [
    'old',
  ]);
});
