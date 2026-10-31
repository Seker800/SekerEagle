import { Prisma, type LibraryMode } from '@prisma/client';
import type { DuplicateCandidate } from '@sekereagle/library-core';
import type { Snapshot } from './eagle-duplicate-model';
import { DUPLICATE_FINGERPRINT_VERSION } from './eagle-duplicate-fingerprint';

/** Full-library reads must join in SQL, not expand composite relations into ID parameters. */
function scope(ownerId: string, libraryMode: LibraryMode, includePrivate: boolean) {
  return Prisma.sql`a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
    AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut"
    ${includePrivate ? Prisma.empty : Prisma.sql`AND NOT a."isPrivate"`}`;
}

export function readMissingDuplicateFingerprints(
  tx: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
) {
  return tx.$queryRaw<Snapshot[]>`SELECT a.id,a."rowVersion",a."mediaRevision"
    FROM "EagleAsset" a WHERE ${scope(ownerId, libraryMode, includePrivate)}
    AND a."mimeType" LIKE 'image/%' AND a."lifecycleStatus"='READY'
    AND NOT EXISTS (SELECT 1 FROM "EagleDuplicateFingerprint" f
      WHERE f."ownerId"=a."ownerId" AND f."libraryMode"=a."libraryMode" AND f."assetId"=a.id
      AND f."mediaRevision"=a."mediaRevision" AND f."processorVersion"=${DUPLICATE_FINGERPRINT_VERSION})
    ORDER BY a.id`;
}

export async function readDuplicateCandidates(
  tx: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
): Promise<DuplicateCandidate[]> {
  const rows = await tx.$queryRaw<
    Array<
      Omit<DuplicateCandidate, 'byteSize' | 'libraryAddedAt'> & {
        byteSize: bigint;
        libraryAddedAt: Date;
      }
    >
  >`SELECT a.id,a.sha256,a."byteSize",a."rowVersion",a."mediaRevision",a."isPrivate",
    a.format,a.width,a.height,a.rating,a."libraryAddedAt",
    EXISTS(SELECT 1 FROM "EagleAssetEditRecipe" e WHERE e."assetId"=a.id AND e."ownerId"=a."ownerId" AND e."libraryMode"=a."libraryMode" AND e."baseAssetId" IS NOT NULL) AS "isEdited",
    CASE WHEN f."assetId" IS NULL THEN NULL ELSE
      jsonb_build_object('hash',f.hash,'colors',f.colors,'contrast',f.contrast) END AS fingerprint
    FROM "EagleAsset" a LEFT JOIN "EagleDuplicateFingerprint" f
      ON f."ownerId"=a."ownerId" AND f."libraryMode"=a."libraryMode" AND f."assetId"=a.id
      AND f."mediaRevision"=a."mediaRevision" AND f."processorVersion"=${DUPLICATE_FINGERPRINT_VERSION}
    WHERE ${scope(ownerId, libraryMode, includePrivate)}`;
  return rows.map((row) => ({
    ...row,
    byteSize: Number(row.byteSize),
    libraryAddedAt: row.libraryAddedAt.toISOString(),
  }));
}
