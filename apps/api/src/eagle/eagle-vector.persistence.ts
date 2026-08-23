import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

type VectorSqlClient = Pick<Prisma.TransactionClient, '$executeRaw' | '$queryRaw'>;

function readMinimumSuggestionScore() {
  const configured = Number(process.env.EAGLE_VECTOR_MINIMUM_SCORE ?? 0.3);
  return Number.isFinite(configured) ? Math.max(-1, Math.min(1, configured)) : 0.3;
}

export async function refreshUnclassifiedSuggestions(
  transaction: VectorSqlClient,
  input: { ownerId: string; assetIds?: string[]; includePrivate?: boolean },
) {
  if (input.assetIds?.length === 0) return { scanned: 0, matched: 0 };
  const generationId = randomUUID();
  const minimumScore = readMinimumSuggestionScore();
  const assetScope = input.assetIds
    ? Prisma.sql`AND asset.id IN (${Prisma.join(input.assetIds)})`
    : Prisma.empty;
  const privateScope = input.includePrivate
    ? Prisma.empty
    : Prisma.sql`AND asset."isPrivate" = false`;
  const rows = await transaction.$queryRaw<Array<{ scanned: number; matched: number }>>(
    Prisma.sql`
      WITH owner_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtextextended(${input.ownerId}, 913421))
      ), eligible AS MATERIALIZED (
        SELECT asset.id AS "assetId", embedding.id AS "embeddingId", embedding.embedding
        FROM "EagleAsset" asset
        JOIN "EagleAssetEmbedding" embedding
          ON embedding."ownerId" = asset."ownerId" AND embedding."assetId" = asset.id
         AND embedding."isCurrent" = true AND embedding.status = 'READY'
        CROSS JOIN owner_lock
        WHERE asset."ownerId" = ${input.ownerId}
          AND asset."deletedAt" IS NULL
          AND asset."mimeType" LIKE 'image/%'
          ${privateScope}
          ${assetScope}
          AND NOT EXISTS (
            SELECT 1 FROM "EagleAssetManualTag" "manualTag"
            WHERE "manualTag"."ownerId" = asset."ownerId"
              AND "manualTag"."assetId" = asset.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM "EagleVectorTagSuggestion" suggestion
            WHERE suggestion."ownerId" = asset."ownerId"
              AND suggestion."assetId" = asset.id
              AND suggestion.status = 'PENDING'
              AND suggestion."isActive" = true
              AND suggestion."invalidatedAt" IS NULL
          )
      ), candidates AS MATERIALIZED (
        SELECT eligible."assetId", eligible."embeddingId", nearest."tagId",
               nearest."snapshotId", nearest.rank, nearest.distance
        FROM eligible
        CROSS JOIN LATERAL (
          SELECT snapshot."tagId", snapshot.id AS "snapshotId", prototype.rank,
                 prototype.embedding <=> eligible.embedding AS distance
          FROM "EagleTagPrototypeSnapshot" snapshot
          JOIN "EagleTagPrototype" prototype
            ON prototype."ownerId" = snapshot."ownerId"
           AND prototype."snapshotId" = snapshot.id
          JOIN "EagleManualTagSemanticConfig" config
            ON config."ownerId" = snapshot."ownerId" AND config."tagId" = snapshot."tagId"
          WHERE snapshot."ownerId" = ${input.ownerId}
            AND snapshot."isCurrent" = true
            AND snapshot.status = 'ACTIVE'
            AND config."recommendationEnabled" = true
          ORDER BY prototype.embedding <=> eligible.embedding
          LIMIT 1
        ) nearest
      ), inserted AS (
        INSERT INTO "EagleVectorTagSuggestion" (
          id, "ownerId", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
          "generationId", "isActive", score, distance, "prototypeRank", status,
          "createdAt", "updatedAt"
        )
        SELECT gen_random_uuid()::text, ${input.ownerId}, candidate."assetId", candidate."tagId",
               candidate."embeddingId", candidate."snapshotId", ${generationId}, true,
               1 - candidate.distance, candidate.distance, candidate.rank,
               'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
        FROM candidates candidate
        WHERE 1 - candidate.distance >= ${minimumScore}
        RETURNING id
      )
      SELECT (SELECT COUNT(*)::integer FROM eligible) AS scanned,
             (SELECT COUNT(*)::integer FROM inserted) AS matched
    `,
  );
  return rows[0] ?? { scanned: 0, matched: 0 };
}

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
