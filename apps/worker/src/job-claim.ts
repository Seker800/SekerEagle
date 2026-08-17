import type {
  EagleAssetProcessingJob,
  EagleMediaJobStatus,
  EagleProcessingLane,
} from '@prisma/client';

const CLAIM_BATCH_SIZE = 50;
const STALE_LEASE_MS = 10 * 60 * 1_000;
const LANE_ORDER: readonly EagleProcessingLane[] = [
  'INTERACTIVE',
  'BACKGROUND',
  'MAINTENANCE',
];

interface ClaimFindManyInput {
  where: {
    lane: EagleProcessingLane;
    OR: Array<
      | { status: 'PENDING'; availableAt: { lte: Date } }
      | { status: 'PROCESSING'; lockedAt: { lt: Date } }
    >;
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
  };
  data: {
    status: 'PROCESSING';
    lockedAt: Date;
    startedAt: Date;
    attempts: { increment: 1 };
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
  now?: Date;
  canClaimBackground(ownerId: string): Promise<boolean>;
}

export async function claimNextMediaJob(
  client: MediaJobClaimClient,
  options: ClaimMediaJobOptions,
): Promise<EagleAssetProcessingJob | null> {
  const now = options.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_LEASE_MS);

  for (const lane of LANE_ORDER) {
    const candidates = await client.eagleAssetProcessingJob.findMany({
      where: {
        lane,
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
        ],
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: CLAIM_BATCH_SIZE,
    });

    for (const candidate of candidates) {
      if (
        candidate.lane === 'BACKGROUND' &&
        !(await options.canClaimBackground(candidate.ownerId))
      ) {
        continue;
      }
      const claimed = await client.eagleAssetProcessingJob.updateMany({
        where: {
          id: candidate.id,
          leaseVersion: candidate.leaseVersion,
          ...(candidate.status === 'PENDING'
            ? { status: 'PENDING' as const }
            : { status: 'PROCESSING' as const, lockedAt: { lt: staleBefore } }),
        },
        data: {
          status: 'PROCESSING',
          lockedAt: now,
          startedAt: candidate.startedAt ?? now,
          attempts: { increment: 1 },
          leaseVersion: { increment: 1 },
        },
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
