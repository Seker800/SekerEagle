import { Prisma, type EagleTagSemanticBuild, type PrismaClient } from '@prisma/client';
import {
  backgroundScheduleSql,
  taskPolicyAllowsSql,
  taskPrioritySql,
} from '@sekereagle/library-persistence';

export async function claimNextScheduledTagBuild(
  client: Pick<PrismaClient, '$transaction' | '$queryRaw'>,
  now = new Date(),
) {
  const candidates = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT b.id FROM "EagleTagSemanticBuild" b WHERE
      ((b.status='PENDING' AND b."availableAt"<=now()) OR (b.status='PROCESSING' AND b."lockedAt"<now()-interval '10 minutes'))
      AND ${backgroundScheduleSql(Prisma.sql`b."ownerId"`, Prisma.sql`b."libraryMode"`)}
      AND ${taskPolicyAllowsSql(Prisma.sql`b."ownerId"`, Prisma.sql`b."libraryMode"`, Prisma.sql`'TAG_INDEX'`)}
    ORDER BY ${taskPrioritySql(Prisma.sql`b."ownerId"`, Prisma.sql`b."libraryMode"`, Prisma.sql`'TAG_INDEX'`)} DESC,b."availableAt",b."createdAt" LIMIT 50
  `);
  if (!candidates.length) return null;
  return claimNextTagBuild(
    client,
    now,
    candidates.map(({ id }) => id),
  );
}

export async function claimNextTagBuild(
  client: Pick<PrismaClient, '$transaction'>,
  now = new Date(),
  eligibleIds?: string[],
): Promise<EagleTagSemanticBuild | null> {
  return client.$transaction(async (transaction) => {
    const candidate = await transaction.eagleTagSemanticBuild.findFirst({
      where: {
        ...(eligibleIds ? { id: { in: eligibleIds } } : {}),
        OR: [
          { status: 'PENDING', availableAt: { lte: now } },
          { status: 'PROCESSING', lockedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
        ],
      },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;
    const retireCandidate = async (failureCode: string) => {
      if (!candidate.candidateSnapshotId) return;
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: {
          id: candidate.candidateSnapshotId,
          ownerId: candidate.ownerId,
          libraryMode: candidate.libraryMode,
          status: 'BUILDING',
        },
        data: { status: 'FAILED', failureCode },
      });
    };
    if (candidate.attempts >= 12) {
      const exhausted = await transaction.eagleTagSemanticBuild.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          leaseVersion: candidate.leaseVersion,
          lockedAt: candidate.lockedAt,
        },
        data: {
          status: 'FAILED',
          lockedAt: null,
          completedAt: now,
          lastError: 'BUILD_ATTEMPTS_EXHAUSTED',
        },
      });
      if (exhausted.count === 1) await retireCandidate('BUILD_ATTEMPTS_EXHAUSTED');
      return null;
    }
    const claimed = await transaction.eagleTagSemanticBuild.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        leaseVersion: candidate.leaseVersion,
        lockedAt: candidate.lockedAt,
      },
      data: {
        status: 'PROCESSING',
        candidateSnapshotId: null,
        attempts: { increment: 1 },
        leaseVersion: { increment: 1 },
        lockedAt: now,
        startedAt: candidate.startedAt ?? now,
        lastError: null,
      },
    });
    if (claimed.count !== 1) return null;
    await retireCandidate('BUILD_LEASE_EXPIRED');
    return transaction.eagleTagSemanticBuild.findUnique({ where: { id: candidate.id } });
  });
}

export async function holdTagBuildLease(
  transaction: Pick<Prisma.TransactionClient, 'eagleTagSemanticBuild'>,
  build: Pick<EagleTagSemanticBuild, 'id' | 'ownerId' | 'libraryMode' | 'leaseVersion'>,
  now = new Date(),
): Promise<void> {
  const held = await transaction.eagleTagSemanticBuild.updateMany({
    where: {
      id: build.id,
      ownerId: build.ownerId,
      libraryMode: build.libraryMode,
      status: 'PROCESSING',
      leaseVersion: build.leaseVersion,
    },
    data: { lockedAt: now },
  });
  if (held.count !== 1) throw new Error('TAG_BUILD_LEASE_LOST');
}
