import { Prisma, type LibraryMode } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ImageSearchPosition } from './eagle-image-search.service';

export async function rankSmartFolderMatches(
  prisma: PrismaService,
  scope: { ownerId: string; libraryMode: LibraryMode },
  folderIds: string[],
  after: ImageSearchPosition | undefined,
  limit: number,
  includePrivate: boolean,
  trash: boolean,
  allowedIds?: string[],
): Promise<ImageSearchPosition[]> {
  if (allowedIds?.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{ assetId: string; similarity: number; libraryAddedAt: Date }>
  >(Prisma.sql`
    WITH ranked AS (
      SELECT a.id AS "assetId", max(m.similarity) AS similarity, a."libraryAddedAt"
      FROM "EagleSmartFolderSemanticMatch" m
      JOIN "EagleSmartFolderSemanticSnapshot" s ON s.id=m."snapshotId" AND s."ownerId"=m."ownerId" AND s."libraryMode"=m."libraryMode" AND s."isActive"
      JOIN "EagleAssetEmbedding" e ON e.id=m."embeddingId" AND e."ownerId"=m."ownerId" AND e."libraryMode"=m."libraryMode"
      JOIN "EagleAsset" a ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
      WHERE m."ownerId"=${scope.ownerId} AND m."libraryMode"=${scope.libraryMode}::"LibraryMode"
        AND s."folderId"=ANY(${folderIds}::text[])
        ${includePrivate ? Prisma.empty : Prisma.sql`AND NOT a."isPrivate"`}
        ${trash ? Prisma.sql`AND a."deletedAt" IS NOT NULL AND a."purgeAfter" IS NULL` : Prisma.sql`AND a."deletedAt" IS NULL`}
        ${allowedIds ? Prisma.sql`AND a.id=ANY(${allowedIds}::text[])` : Prisma.empty}
      GROUP BY a.id
    ) SELECT * FROM ranked
    ${after ? Prisma.sql`WHERE (similarity,"assetId")<(${after.similarity},${after.assetId})` : Prisma.empty}
    ORDER BY similarity DESC,"assetId" DESC LIMIT ${limit}
  `);
  return rows.map((row) => ({ ...row, tier: 1, libraryAddedAt: row.libraryAddedAt.toISOString() }));
}
