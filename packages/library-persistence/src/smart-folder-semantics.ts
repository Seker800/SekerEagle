import { createHash } from 'node:crypto';
import { Prisma, type LibraryMode } from '@prisma/client';

export interface SmartFolderIntent {
  text: string;
  breadth: 'STRICT' | 'BALANCED' | 'BROAD';
}
export interface SmartFolderScope {
  ownerId: string;
  libraryMode: LibraryMode;
}

/** Caller holds the folder write lock; no inference or retrieval runs in the request. */
export async function scheduleSmartFolderSnapshot(
  tx: Prisma.TransactionClient,
  scope: SmartFolderScope,
  folderId: string,
  intent: SmartFolderIntent | undefined,
  spaceId: string,
  threshold?: number,
) {
  const where = { ...scope, folderId };
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "EagleSmartFolderSemanticSnapshot"
    WHERE "ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode" AND "folderId"=${folderId}
    ORDER BY id FOR NO KEY UPDATE`);
  if (!intent) {
    await tx.eagleSmartFolderSemanticSnapshot.deleteMany({ where });
    return;
  }
  if (threshold === undefined || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw new Error('INVALID_SMART_FOLDER_THRESHOLD');
  const intentKey = createHash('sha256')
    .update(JSON.stringify([intent.text, intent.breadth, spaceId]))
    .digest('hex');
  const current = await tx.eagleSmartFolderSemanticSnapshot.findFirst({
    where: { ...where, intentKey },
  });
  if (current && current.status !== 'FAILED') {
    // Reverting to the active intent cancels any newer unfinished request.
    await tx.eagleSmartFolderSemanticSnapshot.deleteMany({
      where: { ...where, isActive: false, id: { not: current.id } },
    });
    return;
  }
  await tx.eagleSmartFolderSemanticSnapshot.deleteMany({ where: { ...where, isActive: false } });
  await tx.eagleSmartFolderSemanticSnapshot.create({
    data: { ...where, intentKey, ...intent, spaceId, threshold },
  });
}

/** Match only the newly published vector; ordinary filter changes need no reindexing. */
export async function matchSmartFoldersForEmbedding(
  tx: Prisma.TransactionClient,
  scope: SmartFolderScope,
  embeddingId: string,
): Promise<void> {
  // Same ordered snapshot locks as rebuild activation; avoid multi-snapshot lock inversion.
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "EagleSmartFolderSemanticSnapshot"
    WHERE "ownerId"=${scope.ownerId} AND "libraryMode"=${scope.libraryMode}::"LibraryMode"
      AND ("isActive" OR status='BUILDING') AND "queryVector" IS NOT NULL
    ORDER BY id FOR NO KEY UPDATE`);
  await tx.$executeRaw(Prisma.sql`
    WITH matched AS (INSERT INTO "EagleSmartFolderSemanticMatch" ("ownerId", "libraryMode", "snapshotId", "embeddingId", similarity)
    SELECT e."ownerId", e."libraryMode", s.id, e.id, 1 - (e.embedding <=> s."queryVector")
    FROM "EagleAssetEmbedding" e
    JOIN "EagleAsset" a ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode" AND a."mediaRevision"=e."assetRevision"
    JOIN "EagleSmartFolderSemanticSnapshot" s ON s."ownerId"=e."ownerId" AND s."libraryMode"=e."libraryMode" AND s."spaceId"=e."spaceId"
    WHERE e.id=${embeddingId} AND e."ownerId"=${scope.ownerId} AND e."libraryMode"=${scope.libraryMode}::"LibraryMode"
      AND e."isCurrent" AND e.status='READY' AND e.embedding IS NOT NULL
      AND (s."isActive" OR s.status='BUILDING') AND s."queryVector" IS NOT NULL
      AND 1 - (e.embedding <=> s."queryVector") >= s.threshold
    ON CONFLICT ("snapshotId", "embeddingId") DO UPDATE SET similarity=EXCLUDED.similarity
    RETURNING "snapshotId")
    UPDATE "EagleSmartFolderSemanticSnapshot" SET "updatedAt"=now()
    WHERE id IN (SELECT "snapshotId" FROM matched)
  `);
}

export function smartFolderMatchWhere(
  scope: SmartFolderScope,
  folderId: string,
): Prisma.EagleAssetWhereInput {
  return {
    embeddings: {
      some: {
        ...scope,
        smartFolderMatches: {
          some: {
            ...scope,
            snapshot: { ...scope, folderId, isActive: true },
          },
        },
      },
    },
  };
}
