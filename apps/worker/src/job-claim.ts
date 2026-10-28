import {
  MEDIA_LEASE_MS,
  mediaClaimTransition,
  isBackgroundFamily,
  mediaTaskFamily,
} from '@sekereagle/library-core';
import type {
  EagleAssetProcessingJob,
  EagleMediaJobStatus,
  EagleMediaJobKind,
  EagleProcessingLane,
} from '@prisma/client';

const CLAIM_BATCH_SIZE = 50;

const LANE_ORDER: readonly EagleProcessingLane[] = ['INTERACTIVE', 'BACKGROUND', 'MAINTENANCE'];

export interface ClaimFindManyInput {
  where: {
    lane: EagleProcessingLane;
    processorVersion?: { notIn: string[] };
    kind?: { not?: EagleMediaJobKind; in?: EagleMediaJobKind[] } | EagleMediaJobKind;
    AND: [
      {
        OR: Array<{ dependsOnJobId: null } | { dependsOnJob: { status: 'COMPLETED' } }>;
      },
      {
        OR: Array<
          | { status: 'PENDING'; availableAt: { lte: Date } }
          | { status: 'PROCESSING'; lockedAt: { lt: Date } }
        >;
      },
    ];
  };
  orderBy: Array<{ availableAt: 'asc' } | { createdAt: 'asc' }>;
  take: number;
}

interface ClaimUpdateInput {
  where: {
    id: string;
    leaseVersion: number;
    status: EagleMediaJobStatus;
    lockedAt?: { lt: Date };
    availableAt?: { lte: Date };
  };
  data: {
    status: 'PROCESSING';
    lockedAt: Date;
    startedAt: Date;
    attempts: { increment: 1 };
    recoveryCount: { increment: number };
    leaseVersion: { increment: 1 };
  };
}

export interface MediaJobClaimClient {
  eagleAssetProcessingJob: {
    findMany(input: ClaimFindManyInput): Promise<EagleAssetProcessingJob[]>;
    updateMany(input: ClaimUpdateInput): Promise<{ count: number }>;
    findUniqueOrThrow(input: { where: { id: string } }): Promise<EagleAssetProcessingJob>;
  };
}

interface ClaimMediaJobOptions {
  onLeaseExhausted(job: EagleAssetProcessingJob, expiredBefore: Date): Promise<void>;
  selectCandidates?: (input: ClaimFindManyInput) => Promise<EagleAssetProcessingJob[]>;
  now?: Date;
  excludedProcessorVersions?: string[];
  allowedJobKinds?: readonly EagleMediaJobKind[];
  laneOrder?: readonly EagleProcessingLane[];
  canClaimBackground(
    ownerId: string,
    kind: EagleAssetProcessingJob['kind'],
    libraryMode: EagleAssetProcessingJob['libraryMode'],
    processorVersion?: string,
  ): Promise<boolean>;
}

// Ephemeral hints only: the durable status/lease CAS below remains authoritative.
// Hold attempted versions until overlapping local claim calls have all returned,
// so stale selector snapshots do not serialize duplicate writes on the same row.
const localClaims = new WeakMap<MediaJobClaimClient, { active: number; attempted: Set<string> }>();

export async function claimNextMediaJob(
  client: MediaJobClaimClient,
  options: ClaimMediaJobOptions,
): Promise<EagleAssetProcessingJob | null> {
  let cohort = localClaims.get(client);
  if (!cohort) {
    cohort = { active: 0, attempted: new Set() };
    localClaims.set(client, cohort);
  }
  cohort.active++;
  try {
    return await claimNextUncontendedMediaJob(client, options, cohort.attempted);
  } finally {
    if (--cohort.active === 0) localClaims.delete(client);
  }
}

async function claimNextUncontendedMediaJob(
  client: MediaJobClaimClient,
  options: ClaimMediaJobOptions,
  attempted: Set<string>,
): Promise<EagleAssetProcessingJob | null> {
  if (options.allowedJobKinds?.length === 0) return null;
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - MEDIA_LEASE_MS);

  for (const lane of options.laneOrder ?? LANE_ORDER) {
    const kindFilter = {
      not: 'GENERATE_AI_TAGS' as const,
      ...(options.allowedJobKinds ? { in: [...options.allowedJobKinds] } : {}),
    };
    const candidates = await (
      options.selectCandidates ?? ((input) => client.eagleAssetProcessingJob.findMany(input))
    )({
      where: {
        lane,
        ...(options.excludedProcessorVersions?.length
          ? { processorVersion: { notIn: options.excludedProcessorVersions } }
          : {}),
        kind: kindFilter,
        AND: [
          { OR: [{ dependsOnJobId: null }, { dependsOnJob: { status: 'COMPLETED' } }] },
          {
            OR: [
              { status: 'PENDING', availableAt: { lte: now } },
              { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
            ],
          },
        ],
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: CLAIM_BATCH_SIZE,
    });

    for (const candidate of candidates) {
      if (candidate.kind === 'GENERATE_AI_TAGS') continue;
      if (
        isBackgroundFamily(mediaTaskFamily(candidate.kind, candidate.processorVersion)) &&
        !(await options.canClaimBackground(
          candidate.ownerId,
          candidate.kind,
          candidate.libraryMode,
          candidate.processorVersion,
        ))
      ) {
        continue;
      }
      const transition = mediaClaimTransition(candidate, now);
      if (!transition) continue;
      const versionKey = JSON.stringify([candidate.id, candidate.leaseVersion]);
      if (attempted.has(versionKey)) continue;
      attempted.add(versionKey);
      // A continuously overlapping cohort must not retain an unbounded history.
      if (attempted.size > 1024) attempted.delete(attempted.values().next().value!);
      if (transition.kind === 'EXHAUSTED') {
        await options.onLeaseExhausted(candidate, transition.expiredBefore);
        continue;
      }
      const claimed = await client.eagleAssetProcessingJob.updateMany({
        where: { id: candidate.id, ...transition.where },
        data: transition.data,
      });
      if (claimed.count === 1) {
        return client.eagleAssetProcessingJob.findUniqueOrThrow({
          where: { id: candidate.id },
        });
      }
    }
  }

  return null;
}
