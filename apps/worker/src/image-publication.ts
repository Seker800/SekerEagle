import type { EagleAsset, EagleAssetProcessingJob, Prisma, PrismaClient } from '@prisma/client';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import { persistPhotoAnalysis } from './photo-analysis-persistence';
import { groupAnalyzedPhoto } from './photo-grouping';
import { FACE_MODEL_VERSION } from './photo-faces';

type Asset = Pick<EagleAsset, 'id' | 'ownerId' | 'libraryMode' | 'sha256' | 'mediaRevision' | 'chronologicalAt' | 'libraryAddedAt'>;
type Job = Pick<EagleAssetProcessingJob, 'id' | 'ownerId' | 'libraryMode' | 'assetId' | 'assetRevision' | 'leaseVersion'>;
interface ImagePublication {
  asset: Asset;
  job: Job;
  renditions: Prisma.EagleAssetRenditionUncheckedCreateInput[];
  sha256: string;
  dimensions: { width?: number; height?: number };
  photoAnalysis: Parameters<typeof persistPhotoAnalysis>[2] | null;
  livePhoto: { identifier: string | null } | null;
  scheduleFaces: boolean;
}
const defaults = { lockPrivacy: lockOwnerPrivacyProjection, syncPrivacy: syncAssetPrivacy, persistAnalysis: persistPhotoAnalysis, group: groupAnalyzedPhoto };

/** Both rendered and imported derivatives publish through this scoped, lease-fenced transaction. */
export async function publishImage(client: Pick<PrismaClient, '$transaction'>, input: ImagePublication, dependencies = defaults): Promise<boolean> {
  const { asset, job, renditions, sha256, dimensions, photoAnalysis, livePhoto } = input;
  if (job.ownerId !== asset.ownerId || job.libraryMode !== asset.libraryMode || job.assetId !== asset.id || job.assetRevision !== asset.mediaRevision || renditions.some(r => r.ownerId !== asset.ownerId || r.libraryMode !== asset.libraryMode || r.assetId !== asset.id || r.revision !== job.assetRevision || !r.storageKey.startsWith(`users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/`)))
    throw new Error('IMAGE_PUBLICATION_SCOPE');
  return client.$transaction(async tx => {
    await dependencies.lockPrivacy(tx, asset.ownerId, asset.libraryMode);
    if (asset.libraryMode === 'PHOTO') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${asset.ownerId}`}))`;
    await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${asset.id} AND "ownerId"=${asset.ownerId} AND "libraryMode"=${asset.libraryMode}::"LibraryMode" FOR UPDATE`;
    const current = await tx.eagleAsset.findFirst({ where: { id: asset.id, ownerId: asset.ownerId, libraryMode: asset.libraryMode, mediaRevision: job.assetRevision, deletedAt: null, sha256: asset.sha256 } });
    if (!current) return false;
    const completed = await tx.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, ownerId: job.ownerId, libraryMode: job.libraryMode, assetId: job.assetId, assetRevision: job.assetRevision, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
    if (completed.count !== 1) return false;
    for (const rendition of renditions) await tx.eagleAssetRendition.upsert({
      where: { assetId_kind_revision_variant: { assetId: rendition.assetId, kind: rendition.kind, revision: rendition.revision, variant: rendition.variant ?? 'default' } }, create: rendition, update: rendition,
    });
    if (asset.libraryMode === 'PHOTO' && input.scheduleFaces) await tx.eagleAssetProcessingJob.createMany({ data: [{ ownerId: asset.ownerId, libraryMode: 'PHOTO', assetId: asset.id, assetRevision: job.assetRevision, kind: 'ANALYZE_PHOTO_FACES', processorVersion: FACE_MODEL_VERSION, lane: 'BACKGROUND', dependsOnJobId: job.id }], skipDuplicates: true });
    if (photoAnalysis) {
      await dependencies.persistAnalysis(tx, asset, photoAnalysis, job.assetRevision);
      await dependencies.group(tx, asset.ownerId, asset.id);
    }
    await tx.eagleAsset.updateMany({ where: { id: asset.id, ownerId: asset.ownerId, libraryMode: asset.libraryMode, mediaRevision: job.assetRevision }, data: { lifecycleStatus: 'READY', mediaErrorCode: null, sha256, ...dimensions, livePhotoIdentifier: livePhoto?.identifier ?? null, livePhotoRole: livePhoto?.identifier ? 'STILL' : null } });
    await dependencies.syncPrivacy(tx, asset.ownerId, [asset.id], asset.libraryMode);
    return true;
  }, { timeout: 30000, maxWait: 10000 });
}
