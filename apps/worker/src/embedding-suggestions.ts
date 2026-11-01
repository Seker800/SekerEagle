import { unreviewedSuggestionEvidenceSql } from '@sekereagle/library-persistence';
import { Prisma, type LibraryMode } from '@prisma/client';

export async function createTopEmbeddingSuggestion(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  embeddingId: string,
  minimumScore: number,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleVectorTagSuggestion" (
        "id", "ownerId", "libraryMode", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", "score", "distance", "prototypeRank", "status", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, ${ownerId}, ${libraryMode}::"LibraryMode", ${assetId}, candidate."tagId", ${embeddingId},
             candidate."snapshotId", candidate."generationId", true, 1 - candidate.distance,
             candidate.distance, candidate.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM (
        SELECT snapshot."tagId", prototype."snapshotId", snapshot."generationId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleAssetEmbedding" embedding
        JOIN "EagleAsset" asset ON asset.id=embedding."assetId" AND asset."ownerId"=embedding."ownerId"
          AND asset."libraryMode"=embedding."libraryMode" AND asset."mediaRevision"=embedding."assetRevision"
        JOIN "EagleEmbeddingSpace" space ON space.id=embedding."spaceId" AND space."isCurrent"
        JOIN "EagleTagPrototype" prototype ON prototype."ownerId" = embedding."ownerId" AND prototype."libraryMode" = embedding."libraryMode"
        JOIN "EagleTagPrototypeSnapshot" snapshot
          ON snapshot."ownerId" = prototype."ownerId" AND snapshot."libraryMode" = prototype."libraryMode" AND snapshot.id = prototype."snapshotId"
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."libraryMode" = snapshot."libraryMode" AND config."tagId" = snapshot."tagId"
        WHERE embedding."ownerId" = ${ownerId} AND embedding."libraryMode" = ${libraryMode}::"LibraryMode" AND embedding.id = ${embeddingId}
          AND embedding."assetId"=${assetId} AND embedding."isCurrent" AND embedding.status = 'READY'
          AND asset."deletedAt" IS NULL AND NOT asset."storageTransferredOut"
          AND snapshot."spaceId" = embedding."spaceId"
          AND snapshot."isCurrent" = true AND snapshot.status = 'ACTIVE'
          AND config."recommendationEnabled" = true
        ORDER BY prototype.embedding <=> embedding.embedding ASC
        LIMIT 1
      ) candidate
      WHERE 1 - candidate.distance >= ${minimumScore}
        AND ${unreviewedSuggestionEvidenceSql({ ownerId, libraryMode }, Prisma.sql`${embeddingId}`, Prisma.sql`candidate."tagId"`, Prisma.sql`candidate."snapshotId"`)}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = ${ownerId} AND manual."libraryMode" = ${libraryMode}::"LibraryMode" AND manual."assetId" = ${assetId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "EagleVectorTagSuggestion" existing
          WHERE existing."ownerId" = ${ownerId} AND existing."libraryMode" = ${libraryMode}::"LibraryMode" AND existing."assetId" = ${assetId}
            AND existing."isActive" = true AND existing.status = 'PENDING' AND existing."invalidatedAt" IS NULL
        )
    `,
  );
}

/** Staging can outlive review or media replacement; activate only evidence still applicable now. */
export async function activateEmbeddingSuggestionGeneration(
  tx: Prisma.TransactionClient,
  scope: { ownerId: string; libraryMode: LibraryMode },
  generationId: string,
): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE "EagleVectorTagSuggestion" suggestion SET "isActive"=true, "updatedAt"=now()
    FROM "EagleAssetEmbedding" embedding
    JOIN "EagleAsset" asset ON asset.id=embedding."assetId" AND asset."ownerId"=embedding."ownerId"
      AND asset."libraryMode"=embedding."libraryMode" AND asset."mediaRevision"=embedding."assetRevision"
    JOIN "EagleEmbeddingSpace" space ON space.id=embedding."spaceId" AND space."isCurrent"
    JOIN "EagleTagPrototypeSnapshot" snapshot ON snapshot."ownerId"=embedding."ownerId"
      AND snapshot."libraryMode"=embedding."libraryMode" AND snapshot."spaceId"=embedding."spaceId"
    JOIN "EagleManualTagSemanticConfig" config ON config."ownerId"=snapshot."ownerId"
      AND config."libraryMode"=snapshot."libraryMode" AND config."tagId"=snapshot."tagId"
    WHERE suggestion."ownerId"=${scope.ownerId} AND suggestion."libraryMode"=${scope.libraryMode}::"LibraryMode"
      AND suggestion."generationId"=${generationId} AND suggestion.status='PENDING' AND suggestion."invalidatedAt" IS NULL
      AND embedding.id=suggestion."embeddingId" AND embedding."ownerId"=suggestion."ownerId"
      AND embedding."libraryMode"=suggestion."libraryMode" AND embedding."assetId"=suggestion."assetId"
      AND embedding."isCurrent" AND embedding.status='READY' AND embedding.embedding IS NOT NULL
      AND asset."deletedAt" IS NULL AND NOT asset."storageTransferredOut"
      AND snapshot.id=suggestion."snapshotId" AND snapshot."isCurrent" AND snapshot.status='ACTIVE'
      AND config."recommendationEnabled" AND snapshot."tagId"=suggestion."suggestedTagId"
      AND ${unreviewedSuggestionEvidenceSql(scope, Prisma.sql`embedding.id`, Prisma.sql`suggestion."suggestedTagId"`, Prisma.sql`suggestion."snapshotId"`)}
      AND NOT EXISTS (SELECT 1 FROM "EagleAssetManualTag" manual
        WHERE manual."ownerId"=suggestion."ownerId" AND manual."libraryMode"=suggestion."libraryMode"
          AND manual."assetId"=suggestion."assetId")
  `);
}
