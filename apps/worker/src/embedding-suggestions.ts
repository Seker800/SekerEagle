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
        AND ${unreviewedSuggestionEvidenceSql({ ownerId, libraryMode }, Prisma.sql`${embeddingId}`, Prisma.sql`candidate."tagId"`)}
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

/** Retrying current evidence must respect the owner's reviewed decision, across prototype rebuilds. */
export function unreviewedSuggestionEvidenceSql(
  scope: { ownerId: string; libraryMode: LibraryMode },
  embeddingId: Prisma.Sql,
  tagId: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "EagleVectorTagSuggestion" reviewed
    WHERE reviewed."ownerId"=${scope.ownerId} AND reviewed."libraryMode"=${scope.libraryMode}::"LibraryMode"
      AND reviewed."embeddingId"=${embeddingId} AND reviewed."suggestedTagId"=${tagId}
      AND (reviewed."reviewedAt" IS NOT NULL OR reviewed.status IN ('ACCEPTED', 'REJECTED'))
  )`;
}
