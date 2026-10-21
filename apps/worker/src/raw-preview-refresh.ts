import { PrismaClient, type EagleAsset } from '@prisma/client';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { isCameraRawMime } from '@sekereagle/library-core';
import { readFile } from 'node:fs/promises';
import {
  assertPhotoMaintenanceCandidates,
  validatePhotoMaintenanceManifest,
  type PhotoMaintenanceCandidate,
  type RefreshItem,
} from './photo-maintenance-scope';
export const RAW_PREVIEW_PROCESSOR_VERSION = 'libraw-srgb-auto001-v2';
type Candidate = PhotoMaintenanceCandidate & Pick<EagleAsset, 'mimeType'>;

export function buildRawPreviewRefreshJobs(manifest: RefreshItem[], assets: Candidate[]) {
  assertPhotoMaintenanceCandidates(manifest, assets);
  if (assets.some((asset) => !isCameraRawMime(asset.mimeType)))
    throw new Error('Only original RAW photos can be refreshed');
  return assets.map((asset) => ({
    ownerId: asset.ownerId,
    libraryMode: 'PHOTO' as const,
    assetId: asset.id,
    assetRevision: asset.mediaRevision,
    kind: 'GENERATE_RENDITIONS' as const,
    lane: 'INTERACTIVE' as const,
    processorVersion: RAW_PREVIEW_PROCESSOR_VERSION,
  }));
}

async function refreshRawPreviews(manifest: RefreshItem[], apply: boolean) {
  assertSafeRuntimeTarget({
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3Endpoint: process.env.S3_ENDPOINT ?? '',
    s3Bucket: process.env.S3_BUCKET ?? '',
  });
  const prisma = new PrismaClient();
  const where = { id: { in: manifest.map((item) => item.assetId) }, libraryMode: 'PHOTO' as const };
  try {
    const assets = await prisma.eagleAsset.findMany({ where, include: { photoMetadata: true } });
    const plan = buildRawPreviewRefreshJobs(manifest, assets);
    if (!apply)
      return { mode: 'plan', count: plan.length, processorVersion: RAW_PREVIEW_PROCESSOR_VERSION };
    const result = await prisma.$transaction(async (tx) => {
      for (const asset of [...assets].sort((a, b) => a.id.localeCompare(b.id)))
        await tx.$queryRaw`SELECT "id" FROM "EagleAsset" WHERE "id"=${asset.id} AND "ownerId"=${asset.ownerId} AND "libraryMode"='PHOTO' FOR UPDATE`;
      const fresh = await tx.eagleAsset.findMany({
        where: { ...where, ownerId: assets[0]!.ownerId },
        include: { photoMetadata: true },
      });
      const jobs = buildRawPreviewRefreshJobs(manifest, fresh);
      return tx.eagleAssetProcessingJob.createMany({ data: jobs, skipDuplicates: true });
    });
    return { mode: 'queued', count: result.count, processorVersion: RAW_PREVIEW_PROCESSOR_VERSION };
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args[0] || args.length > 2 || (args[1] && args[1] !== '--apply'))
    throw new Error('Supply a manifest and optional --apply');
  void readFile(args[0], 'utf8')
    .then((text) =>
      refreshRawPreviews(validatePhotoMaintenanceManifest(JSON.parse(text)), args[1] === '--apply'),
    )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'RAW refresh failed');
      process.exitCode = 1;
    });
}
