import { Prisma, type LibraryMode } from '@prisma/client';

/** Retrying current evidence must respect the owner's reviewed decision, for the same vector and prototype snapshot. */
export function unreviewedSuggestionEvidenceSql(
  scope: { ownerId: string; libraryMode: LibraryMode },
  embeddingId: Prisma.Sql,
  tagId: Prisma.Sql,
  snapshotId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "EagleVectorTagSuggestion" reviewed
    WHERE reviewed."ownerId"=${scope.ownerId} AND reviewed."libraryMode"=${scope.libraryMode}::"LibraryMode"
      AND reviewed."embeddingId"=${embeddingId} AND reviewed."suggestedTagId"=${tagId}
      AND reviewed."snapshotId"=${snapshotId}
      AND (reviewed."reviewedAt" IS NOT NULL OR reviewed.status IN ('ACCEPTED', 'REJECTED'))
  )`;
}
