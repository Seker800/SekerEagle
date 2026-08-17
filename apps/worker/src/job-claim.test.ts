import assert from 'node:assert/strict';
import test from 'node:test';
import type { EagleAssetProcessingJob } from '@prisma/client';
import { claimNextMediaJob } from './job-claim';

function job(
  id: string,
  lane: EagleAssetProcessingJob['lane'],
  overrides: Partial<EagleAssetProcessingJob> = {},
): EagleAssetProcessingJob {
  const now = new Date('2026-08-17T00:00:00.000Z');
  return {
    id,
    ownerId: 'owner-1',
    assetId: `asset-${id}`,
    kind: lane === 'BACKGROUND' ? 'EXTRACT_COLOR_PALETTE' : 'GENERATE_THUMBNAIL',
    status: 'PENDING',
    lane,
    assetRevision: 0,
    processorVersion: 'v1',
    attempts: 0,
    leaseVersion: 0,
    availableAt: now,
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('claims an interactive job before an older background backlog', async () => {
  const queriedLanes: string[] = [];
  const interactive = job('interactive', 'INTERACTIVE');
  const client = {
    eagleAssetProcessingJob: {
      findMany: async ({ where }: { where: { lane: string } }) => {
        queriedLanes.push(where.lane);
        return where.lane === 'INTERACTIVE' ? [interactive] : [job('background', 'BACKGROUND')];
      },
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        ...interactive,
        leaseVersion: 1,
        status: 'PROCESSING' as const,
      }),
    },
  };

  const claimed = await claimNextMediaJob(client, {
    now: new Date('2026-08-17T00:05:00.000Z'),
    canClaimBackground: async () => true,
  });

  assert.equal(claimed?.id, 'interactive');
  assert.deepEqual(queriedLanes, ['INTERACTIVE']);
});

test('continues within the highest-priority lane after a contended candidate', async () => {
  const first = job('first', 'INTERACTIVE');
  const second = job('second', 'INTERACTIVE');
  const attemptedIds: string[] = [];
  const client = {
    eagleAssetProcessingJob: {
      findMany: async () => [first, second],
      updateMany: async ({ where }: { where: { id: string } }) => {
        attemptedIds.push(where.id);
        return { count: where.id === first.id ? 0 : 1 };
      },
      findUniqueOrThrow: async () => ({
        ...second,
        leaseVersion: 1,
        status: 'PROCESSING' as const,
      }),
    },
  };

  const claimed = await claimNextMediaJob(client, {
    now: new Date('2026-08-17T00:05:00.000Z'),
    canClaimBackground: async () => true,
  });

  assert.equal(claimed?.id, 'second');
  assert.deepEqual(attemptedIds, ['first', 'second']);
});

test('skips disallowed background work and falls through to maintenance', async () => {
  const queriedLanes: string[] = [];
  const maintenance = job('maintenance', 'MAINTENANCE', { kind: 'PURGE_ASSET' });
  const client = {
    eagleAssetProcessingJob: {
      findMany: async ({ where }: { where: { lane: string } }) => {
        queriedLanes.push(where.lane);
        if (where.lane === 'BACKGROUND') return [job('background', 'BACKGROUND')];
        if (where.lane === 'MAINTENANCE') return [maintenance];
        return [];
      },
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({
        ...maintenance,
        leaseVersion: 1,
        status: 'PROCESSING' as const,
      }),
    },
  };

  const claimed = await claimNextMediaJob(client, {
    now: new Date('2026-08-17T00:05:00.000Z'),
    canClaimBackground: async () => false,
  });

  assert.equal(claimed?.id, 'maintenance');
  assert.deepEqual(queriedLanes, ['INTERACTIVE', 'BACKGROUND', 'MAINTENANCE']);
});

test('only queries jobs whose dependency completed successfully', async () => {
  let capturedWhere: unknown;
  const client = {
    eagleAssetProcessingJob: {
      findMany: async ({ where }: { where: unknown }) => {
        capturedWhere = where;
        return [];
      },
      updateMany: async () => ({ count: 0 }),
      findUniqueOrThrow: async () => job('unused', 'INTERACTIVE'),
    },
  };

  await claimNextMediaJob(client, {
    now: new Date('2026-08-17T00:05:00.000Z'),
    canClaimBackground: async () => true,
  });

  assert.deepEqual(capturedWhere, {
    lane: 'MAINTENANCE',
    AND: [
      { OR: [{ dependsOnJobId: null }, { dependsOnJob: { status: 'COMPLETED' } }] },
      {
        OR: [
          { status: 'PENDING', availableAt: { lte: new Date('2026-08-17T00:05:00.000Z') } },
          { status: 'PROCESSING', lockedAt: { lt: new Date('2026-08-16T23:55:00.000Z') } },
        ],
      },
    ],
  });
});
