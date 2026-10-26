import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIA_LEASE_MS, mediaClaimTransition, mediaFailure } from './media-task-lifecycle';

const now = new Date('2026-10-26T04:00:00Z');
const expiredBefore = new Date(now.getTime() - MEDIA_LEASE_MS);
const job = {
  id: 'job',
  ownerId: 'owner',
  libraryMode: 'PHOTO' as const,
  assetId: 'asset',
  assetRevision: 2,
  status: 'PROCESSING',
  availableAt: now,
  startedAt: now,
  lockedAt: new Date(expiredBefore.getTime() - 1),
  leaseVersion: 3,
  attempts: 1,
  recoveryCount: 3,
  kind: 'GENERATE_EMBEDDING',
};

test('an exhausted recovery produces a distinct action with no claim mutation', () => {
  const transition = mediaClaimTransition(job, now);
  assert.equal(transition?.kind, 'EXHAUSTED');
  assert.equal(transition && 'data' in transition, false);
});

test('expiry failure preserves the same deadline guard as reclaiming a lease', () => {
  const transition = mediaFailure(job, {
    message: 'MEDIA_LEASE_RECOVERY_EXHAUSTED',
    permanent: true,
    now: now,
    expiredBefore: expiredBefore,
  });
  assert.equal(transition.data.status, 'FAILED');
  assert.deepEqual(transition.where.lockedAt, { lt: expiredBefore });
  assert.equal(transition.where.leaseVersion, job.leaseVersion);
});
