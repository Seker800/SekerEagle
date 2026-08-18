import { Prisma } from '@prisma/client';

type VectorSqlClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

export async function upsertAcceptedSuggestionMemberDistance(
  transaction: VectorSqlClient,
  input: {
    ownerId: string;
    tagId: string;
    assetId: string;
    snapshotId: string;
    embeddingId: string;
  },
) {
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleTagMemberDistance" (
        "ownerId", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
      )
      SELECT ${input.ownerId}, ${input.tagId}, ${input.assetId},
             prototype."snapshotId", prototype.embedding <=> embedding.embedding,
             prototype.rank, NOW()
      FROM "EagleAssetEmbedding" embedding
      CROSS JOIN LATERAL (
        SELECT candidate."snapshotId", candidate.rank, candidate.embedding
        FROM "EagleTagPrototype" candidate
        WHERE candidate."ownerId" = ${input.ownerId}
          AND candidate."snapshotId" = ${input.snapshotId}
        ORDER BY candidate.embedding <=> embedding.embedding
        LIMIT 1
      ) prototype
      WHERE embedding."ownerId" = ${input.ownerId} AND embedding.id = ${input.embeddingId}
      ON CONFLICT ("ownerId", "tagId", "assetId", "snapshotId") DO NOTHING
    `,
  );
}

export async function syncCurrentTagMemberDistances(
  transaction: VectorSqlClient,
  ownerId: string,
  assetIds: string[],
  tagIds: string[],
) {
  if (!assetIds.length || !tagIds.length) return;
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleTagMemberDistance" (
        "ownerId", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
      )
      SELECT link."ownerId", link."tagId", link."assetId", config."currentSnapshotId",
             nearest.distance, nearest.rank, NOW()
      FROM "EagleAssetManualTag" link
      JOIN "EagleManualTagSemanticConfig" config
        ON config."ownerId" = link."ownerId" AND config."tagId" = link."tagId"
       AND config."currentSnapshotId" IS NOT NULL
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
      CROSS JOIN LATERAL (
        SELECT prototype.rank, prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototype" prototype
        WHERE prototype."ownerId" = link."ownerId"
          AND prototype."snapshotId" = config."currentSnapshotId"
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE link."ownerId" = ${ownerId}
        AND link."assetId" IN (${Prisma.join(assetIds)})
        AND link."tagId" IN (${Prisma.join(tagIds)})
      ON CONFLICT ("ownerId", "tagId", "assetId", "snapshotId")
      DO UPDATE SET distance = EXCLUDED.distance,
                    "prototypeRank" = EXCLUDED."prototypeRank",
                    "createdAt" = EXCLUDED."createdAt"
    `,
  );
}
