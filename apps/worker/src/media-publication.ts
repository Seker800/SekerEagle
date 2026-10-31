import type { EagleAssetProcessingJob, Prisma } from '@prisma/client';
import { mediaCompletion } from '@sekereagle/library-core';
import { lockOwnerPrivacyProjection } from '@sekereagle/library-persistence';

export type MediaPublicationJob = Pick<
  EagleAssetProcessingJob,
  'id' | 'ownerId' | 'libraryMode' | 'assetId' | 'assetRevision' | 'leaseVersion'
>;

/** The same owner, mode, active revision and lease boundary for every derivative publisher. */
export async function beginMediaPublication(
  tx: Prisma.TransactionClient,
  job: MediaPublicationJob,
  options: {
    lockPrivacy?: typeof lockOwnerPrivacyProjection;
    photoGroups?: boolean;
    sha256?: string | null;
  } = {},
) {
  await (options.lockPrivacy ?? lockOwnerPrivacyProjection)(tx, job.ownerId, job.libraryMode);
  if (options.photoGroups && job.libraryMode === 'PHOTO')
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${job.ownerId}`}))`;
  await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${job.assetId} AND "ownerId"=${job.ownerId} AND "libraryMode"=${job.libraryMode}::"LibraryMode" FOR UPDATE`;
  const current = await tx.eagleAsset.findFirst({
    where: {
      id: job.assetId,
      ownerId: job.ownerId,
      libraryMode: job.libraryMode,
      mediaRevision: job.assetRevision,
      deletedAt: null,
      ...(options.sha256 !== undefined ? { sha256: options.sha256 } : {}),
    },
    select: { id: true },
  });
  if (!current) {
    await tx.eagleAssetProcessingJob.updateMany({
      ...mediaCompletion(job),
      data: {
        ...mediaCompletion(job).data,
        lastError: 'ASSET_RETIRED',
      },
    });
    return false;
  }
  const completed = await tx.eagleAssetProcessingJob.updateMany({ ...mediaCompletion(job) });
  return completed.count === 1;
}
