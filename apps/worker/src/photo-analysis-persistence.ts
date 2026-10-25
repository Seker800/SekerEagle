import type { EagleAsset, Prisma } from '@prisma/client';
import { photoCaptureMetadata } from '@sekereagle/library-core';
import {
  PHOTO_ANALYSIS_VERSION,
  type normalizePhotoExif,
  type analyzePhotoPixels,
} from './photo-analysis';

type Analysis = Partial<ReturnType<typeof normalizePhotoExif>> &
  Partial<Awaited<ReturnType<typeof analyzePhotoPixels>>> & { processorVersion?: string };
/** Persist pixel measurements without erasing a published edit's original exposure facts. */
export async function persistPhotoAnalysis(
  tx: Prisma.TransactionClient,
  asset: Pick<EagleAsset, 'id' | 'ownerId' | 'libraryMode' | 'chronologicalAt' | 'libraryAddedAt'>,
  analysis: Analysis,
  revision: number,
) {
  const where = {
    ownerId: asset.ownerId,
    libraryMode: asset.libraryMode,
    assetId: asset.id,
    assetRevision: revision,
  };
  const previous = await tx.eaglePhotoMetadata.findFirst({ where });
  const inherited = previous?.captureMetadataInherited === true;
  const metadata = {
    ...analysis,
    ...(inherited ? photoCaptureMetadata(previous) : {}),
    ...where,
    processorVersion: analysis.perceptualHash
      ? (analysis.processorVersion ?? PHOTO_ANALYSIS_VERSION)
      : (previous?.processorVersion ?? 'original-exiftool-v1'),
    captureMetadataInherited: inherited,
  };
  await tx.eaglePhotoMetadata.upsert({
    where: { assetId: asset.id },
    create: metadata,
    update: { ...metadata, analyzedAt: new Date() },
  });
  await tx.eagleAsset.updateMany({
    where: {
      id: asset.id,
      ownerId: asset.ownerId,
      libraryMode: asset.libraryMode,
      mediaRevision: revision,
    },
    data: {
      chronologicalAt: inherited
        ? asset.chronologicalAt
        : (metadata.capturedAt ?? asset.chronologicalAt),
    },
  });
}
