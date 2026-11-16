import type { EagleAssetProcessingJob, Prisma, PrismaClient } from '@prisma/client';

type JobAssetInclude = {
  renditions: {
    select: {
      kind: true;
      variant: true;
      revision: true;
      status: true;
      storageKey: true;
      mimeType: true;
    };
  };
  uploadSessions: {
    select: { eagleState: { select: { expectedContentSha256: true } } };
  };
};

export type JobMediaAsset = Prisma.EagleAssetGetPayload<{ include: JobAssetInclude }>;

export function loadJobAsset(
  prisma: PrismaClient,
  job: EagleAssetProcessingJob,
): Promise<JobMediaAsset | null> {
  return prisma.eagleAsset.findFirst({
    where: {
      id: job.assetId,
      ownerId: job.ownerId,
      libraryMode: job.libraryMode,
      mediaRevision: job.assetRevision,
      deletedAt: null,
    },
    include: {
      renditions: {
        where: {
          revision: job.assetRevision,
          kind: { in: ['THUMBNAIL', 'PREVIEW'] },
          status: 'READY',
        },
        select: {
          kind: true,
          variant: true,
          revision: true,
          status: true,
          storageKey: true,
          mimeType: true,
        },
      },
      uploadSessions: {
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { eagleState: { select: { expectedContentSha256: true } } },
      },
    },
  });
}
