import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type EagleTagSemanticBuild } from '@prisma/client';
import { unreviewedSuggestionEvidenceSql } from '@sekereagle/library-persistence';
import { boundedInteger, boundedNumber } from './bounded';
import type { EmbeddingClientError } from './embedding-client';
import { embeddingBackoff, embeddingRetry } from './embedding-retry';
import { activateEmbeddingSuggestionGeneration } from './embedding-suggestions';
import { holdTagBuildLease } from './tag-build-lease';
import { buildPrototypePlanOffThread, parsePgVector } from './tag-semantic-build';
import type { MediaJobContext } from './handlers/types';

export type TagBuildContext = Pick<
  MediaJobContext,
  'prisma' | 'embeddingSpaceId' | 'embeddingDimensions' | 'resourcePool'
>;

export async function processTagSemanticBuild(
  build: EagleTagSemanticBuild,
  context: TagBuildContext,
): Promise<void> {
  if (build.operation === 'RECOMPUTE_SUGGESTIONS') {
    await recomputeSuggestionGeneration(build, null, context);
    return;
  }
  const [config, space, currentSnapshot, memberStats] = await Promise.all([
    context.prisma.eagleManualTagSemanticConfig.findUnique({
      where: { ownerId_tagId: { ownerId: build.ownerId, tagId: build.tagId } },
    }),
    context.prisma.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } }),
    context.prisma.eagleTagPrototypeSnapshot.findFirst({
      where: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        tagId: build.tagId,
        isCurrent: true,
      },
      select: { id: true, version: true, sourceAssetCount: true },
    }),
    context.prisma.$queryRaw<Array<{ count: bigint; digest: string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count,
             md5(string_agg(link."assetId", ',' ORDER BY link."assetId")) AS digest
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
       AND embedding."assetRevision" = asset."mediaRevision" AND embedding."spaceId" = ${context.embeddingSpaceId}
      WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
        AND asset."deletedAt" IS NULL
    `),
  ]);
  if (!config?.recommendationEnabled) throw new Error('TAG_RECOMMENDATION_DISABLED');
  if (!space) throw new Error('CURRENT_EMBEDDING_SPACE_MISSING');
  const memberCount = Number(memberStats[0]?.count ?? 0n);
  if (!memberCount) throw new Error('TAG_HAS_NO_READY_EMBEDDINGS');
  const sampleLimit = boundedInteger(process.env.EAGLE_TAG_CLUSTER_SAMPLE_SIZE, 2_000, 1, 10_000);
  const sample = await context.prisma.$queryRaw<
    Array<{ assetId: string; embedding: string }>
  >(Prisma.sql`
    SELECT link."assetId", embedding.embedding::text AS embedding
    FROM "EagleAssetManualTag" link
    JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
    JOIN "EagleAssetEmbedding" embedding
      ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
     AND embedding."isCurrent" = true AND embedding.status = 'READY'
     AND embedding."assetRevision" = asset."mediaRevision" AND embedding."spaceId" = ${context.embeddingSpaceId}
    WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
      AND asset."deletedAt" IS NULL
    ORDER BY md5(link."assetId")
    LIMIT ${sampleLimit}
  `);
  const prototypePlan = await buildPrototypePlanOffThread(
    sample.map((row) => ({
      assetId: row.assetId,
      embedding: parsePgVector(row.embedding, context.embeddingDimensions),
    })),
    {
      maxK: boundedInteger(process.env.EAGLE_TAG_MAX_CENTERS, 8, 1, 8),
      minimumRelativeImprovement: boundedNumber(
        process.env.EAGLE_TAG_CENTER_MINIMUM_IMPROVEMENT,
        0.12,
        0,
        1,
      ),
    },
  );
  const generationId = randomUUID();
  const snapshot = await context.prisma.$transaction(async (transaction) => {
    await holdTagBuildLease(transaction, build);
    const versions = await transaction.eagleTagPrototypeSnapshot.aggregate({
      where: { ownerId: build.ownerId, libraryMode: build.libraryMode, tagId: build.tagId },
      _max: { version: true },
    });
    const row = await transaction.eagleTagPrototypeSnapshot.create({
      data: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        tagId: build.tagId,
        spaceId: space.id,
        version: (versions._max.version ?? 0) + 1,
        generationId,
        status: 'BUILDING',
        sourceAssetCount: memberCount,
        sourceSetDigest: memberStats[0]?.digest ?? createHash('sha256').update('').digest('hex'),
        algorithm: 'MINIBATCH_SPHERICAL_KMEANS',
        algorithmVersion: 'v1',
        algorithmParams: {
          maxK: 8,
          minimumRelativeImprovement: 0.12,
          batchSize: 128,
          outlierTrimFraction: 0.02,
          sampleLimit,
          sampleCount: sample.length,
        },
        addedMemberCount: Math.max(0, memberCount - (currentSnapshot?.sourceAssetCount ?? 0)),
        removedMemberCount: Math.max(0, (currentSnapshot?.sourceAssetCount ?? 0) - memberCount),
      },
    });
    await transaction.eagleTagSemanticBuild.update({
      where: { id: build.id },
      data: { candidateSnapshotId: row.id },
    });
    return row;
  });
  for (const prototype of prototypePlan.prototypes) {
    const vector = `[${prototype.embedding.join(',')}]`;
    await context.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "EagleTagPrototype" (
          "ownerId", "libraryMode", "snapshotId", rank, embedding, "memberCount", weight,
          "meanDistance", "p95Distance", "representativeAssetIds", "createdAt"
        ) VALUES (
          ${build.ownerId}, ${build.libraryMode}::"LibraryMode", ${snapshot.id}, ${prototype.rank}, ${vector}::vector,
          ${prototype.memberCount}, ${prototype.weight}, ${prototype.meanDistance},
          ${prototype.p95Distance}, ${prototype.representativeAssetIds}, NOW()
        )
      `,
    );
  }
  await context.prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleTagMemberDistance" (
        "ownerId", "libraryMode", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
      )
      SELECT link."ownerId", link."libraryMode", link."tagId", link."assetId", ${snapshot.id}, nearest.distance,
             nearest.rank, NOW()
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
       AND embedding."assetRevision"=asset."mediaRevision" AND embedding."spaceId"=${context.embeddingSpaceId}
      CROSS JOIN LATERAL (
        SELECT prototype.rank, prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototype" prototype
        WHERE prototype."ownerId" = ${build.ownerId} AND prototype."libraryMode" = ${build.libraryMode}::"LibraryMode" AND prototype."snapshotId" = ${snapshot.id}
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
        AND asset."deletedAt" IS NULL
    `,
  );
  await context.prisma.$executeRaw(
    Prisma.sql`
      UPDATE "EagleTagPrototype" prototype
      SET "memberCount" = statistics."memberCount",
          weight = statistics."memberCount"::double precision / ${memberCount},
          "meanDistance" = statistics."meanDistance",
          "p95Distance" = statistics."p95Distance"
      FROM (
        SELECT distance."prototypeRank" AS rank,
               COUNT(*)::integer AS "memberCount",
               AVG(distance.distance)::double precision AS "meanDistance",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY distance.distance)::double precision
                 AS "p95Distance"
        FROM "EagleTagMemberDistance" distance
        WHERE distance."ownerId" = ${build.ownerId} AND distance."libraryMode" = ${build.libraryMode}::"LibraryMode" AND distance."snapshotId" = ${snapshot.id}
        GROUP BY distance."prototypeRank"
      ) statistics
      WHERE prototype."ownerId" = ${build.ownerId} AND prototype."libraryMode" = ${build.libraryMode}::"LibraryMode"
        AND prototype."snapshotId" = ${snapshot.id}
        AND prototype.rank = statistics.rank
    `,
  );
  await recomputeSuggestionGeneration(build, snapshot.id, context);
}

async function recomputeSuggestionGeneration(
  build: EagleTagSemanticBuild,
  candidateSnapshotId: string | null,
  context: TagBuildContext,
): Promise<void> {
  const generationId = randomUUID();
  const minimumScore = boundedNumber(process.env.EAGLE_VECTOR_MINIMUM_SCORE, 0.3, -1, 1);
  await context.prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleVectorTagSuggestion" (
        "id", "ownerId", "libraryMode", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", score, distance, "prototypeRank", status, "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, embedding."ownerId", embedding."libraryMode", embedding."assetId", nearest."tagId",
             embedding.id, nearest."snapshotId", ${generationId}, false, 1 - nearest.distance,
             nearest.distance, nearest.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM "EagleAssetEmbedding" embedding
      JOIN "EagleAsset" asset ON asset."ownerId" = embedding."ownerId" AND asset."libraryMode" = embedding."libraryMode" AND asset.id = embedding."assetId"
      CROSS JOIN LATERAL (
        SELECT snapshot."tagId", snapshot.id AS "snapshotId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototypeSnapshot" snapshot
        JOIN "EagleTagPrototype" prototype
          ON prototype."ownerId" = snapshot."ownerId" AND prototype."libraryMode" = snapshot."libraryMode" AND prototype."snapshotId" = snapshot.id
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."libraryMode" = snapshot."libraryMode" AND config."tagId" = snapshot."tagId"
        WHERE snapshot."ownerId" = embedding."ownerId" AND snapshot."libraryMode" = embedding."libraryMode"
          AND snapshot."spaceId" = embedding."spaceId"
          AND config."recommendationEnabled" = true
          AND (snapshot.status = 'ACTIVE' OR snapshot.id = ${candidateSnapshotId})
          AND (
            (${candidateSnapshotId}::text IS NOT NULL AND snapshot.id = ${candidateSnapshotId})
            OR (snapshot."isCurrent" = true AND snapshot."tagId" <> ${build.tagId})
            OR (${candidateSnapshotId}::text IS NULL AND snapshot."isCurrent" = true)
          )
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE embedding."ownerId" = ${build.ownerId} AND embedding."libraryMode" = ${build.libraryMode}::"LibraryMode" AND embedding."isCurrent" = true
        AND embedding.status = 'READY' AND embedding."assetRevision" = asset."mediaRevision"
        AND embedding."spaceId" = ${context.embeddingSpaceId} AND asset."deletedAt" IS NULL
        AND 1 - nearest.distance >= ${minimumScore}
        AND ${unreviewedSuggestionEvidenceSql(build, Prisma.sql`embedding.id`, Prisma.sql`nearest."tagId"`, Prisma.sql`nearest."snapshotId"`)}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = embedding."ownerId" AND manual."libraryMode" = embedding."libraryMode" AND manual."assetId" = embedding."assetId"
        )
    `,
  );
  await context.prisma.$transaction(async (transaction) => {
    await holdTagBuildLease(transaction, build);
    await transaction.eagleVectorTagSuggestion.updateMany({
      where: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        isActive: true,
        status: 'PENDING',
        invalidatedAt: null,
      },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        invalidReason: 'PROTOTYPE_GENERATION_REPLACED',
      },
    });
    if (candidateSnapshotId) {
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: {
          ownerId: build.ownerId,
          libraryMode: build.libraryMode,
          tagId: build.tagId,
          isCurrent: true,
        },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      await transaction.eagleTagPrototypeSnapshot.update({
        where: { id: candidateSnapshotId },
        data: { isCurrent: true, status: 'ACTIVE', activatedAt: new Date() },
      });
      await transaction.eagleManualTagSemanticConfig.update({
        where: { ownerId_tagId: { ownerId: build.ownerId, tagId: build.tagId } },
        data: { currentSnapshotId: candidateSnapshotId, lastGeneratedAt: new Date() },
      });
    }
    await activateEmbeddingSuggestionGeneration(transaction, build, generationId);
    await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
  });
}

export async function failTagSemanticBuild(
  build: EagleTagSemanticBuild,
  error: unknown,
  context: TagBuildContext,
): Promise<void> {
  const retry = embeddingRetry(error, build.attempts);
  if (retry) {
    const backoff = embeddingBackoff(error);
    if (
      backoff?.reason === 'WAITING_EMBEDDING_CAPACITY' &&
      (error as EmbeddingClientError).deferResource
    )
      context.resourcePool.defer('EMBEDDING', backoff.delayMs);
    await context.prisma.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: retry.data,
    });
    return;
  }

  const message = error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_TAG_BUILD_ERROR';
  const terminal = build.attempts >= 5 || message === 'TAG_RECOMMENDATION_DISABLED';
  const delaySeconds = Math.min(3_600, 2 ** Math.min(build.attempts, 12));
  await context.prisma.$transaction(async (transaction) => {
    const held = await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: terminal
        ? { status: 'FAILED', completedAt: new Date(), lockedAt: null, lastError: message }
        : {
            status: 'PENDING',
            availableAt: new Date(Date.now() + delaySeconds * 1_000),
            lockedAt: null,
            lastError: message,
          },
    });
    if (held.count !== 1) return;
    const persistedBuild = terminal
      ? await transaction.eagleTagSemanticBuild.findUnique({
          where: { id: build.id },
          select: { candidateSnapshotId: true },
        })
      : null;
    if (terminal && persistedBuild?.candidateSnapshotId) {
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: {
          ownerId: build.ownerId,
          libraryMode: build.libraryMode,
          id: persistedBuild.candidateSnapshotId,
          status: 'BUILDING',
        },
        data: { status: 'FAILED', failureCode: message.slice(0, 100) },
      });
    }
  });
}
