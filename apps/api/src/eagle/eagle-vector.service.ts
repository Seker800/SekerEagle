import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListTagDistanceAssetsDto,
  ListUnclassifiedVectorAssetsDto,
  ListVectorSuggestionsDto,
} from './eagle-vector.dto';
import { EAGLE_EMBEDDING_DIMENSIONS, EAGLE_EMBEDDING_MODEL } from './eagle-vector-semantics';
import { upsertAcceptedSuggestionMemberDistance } from './eagle-vector.persistence';
import { EMBEDDING_PROCESSOR_VERSION, RENDITION_PROCESSOR_VERSION } from './media-job-plan';

@Injectable()
export class EagleVectorService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string, includePrivate = false) {
    const visibleAsset = includePrivate ? {} : { isPrivate: false };
    const [
      eligible,
      ready,
      failed,
      enabledTags,
      readyTags,
      unclassified,
      pendingSuggestions,
      host,
      embeddingJobs,
      processingSetting,
      processableRows,
    ] = await Promise.all([
      this.prisma.eagleAsset.count({
        where: { ownerId, deletedAt: null, mimeType: { startsWith: 'image/' }, ...visibleAsset },
      }),
      this.prisma.eagleAssetEmbedding.count({
        where: {
          ownerId,
          isCurrent: true,
          status: 'READY',
          asset: { deletedAt: null, ...visibleAsset },
        },
      }),
      this.prisma.eagleAssetEmbedding.count({
        where: {
          ownerId,
          isCurrent: true,
          status: 'FAILED',
          asset: { deletedAt: null, ...visibleAsset },
        },
      }),
      this.prisma.eagleManualTagSemanticConfig.count({
        where: { ownerId, recommendationEnabled: true },
      }),
      this.prisma.eagleManualTagSemanticConfig.count({
        where: { ownerId, recommendationEnabled: true, currentSnapshotId: { not: null } },
      }),
      this.prisma.eagleAsset.count({
        where: { ownerId, deletedAt: null, manualTagLinks: { none: {} }, ...visibleAsset },
      }),
      this.prisma.eagleVectorTagSuggestion.count({
        where: {
          ownerId,
          status: 'PENDING',
          isActive: true,
          invalidatedAt: null,
          asset: visibleAsset,
        },
      }),
      this.checkEmbeddingHost(),
      this.prisma.eagleAssetProcessingJob.groupBy({
        by: ['status'],
        where: {
          ownerId,
          kind: 'GENERATE_EMBEDDING',
          processorVersion: EMBEDDING_PROCESSOR_VERSION,
          asset: { deletedAt: null, ...visibleAsset },
        },
        _count: true,
      }),
      this.prisma.eagleProcessingSetting.findUnique({ where: { ownerId } }),
      this.prisma.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::integer AS count
        FROM "EagleAsset" AS asset
        WHERE asset."ownerId" = ${ownerId}
          AND asset."deletedAt" IS NULL
          AND asset."mimeType" LIKE 'image/%'
          AND (${includePrivate} OR asset."isPrivate" = false)
          AND EXISTS (
            SELECT 1
            FROM "EagleAssetRendition" AS preview
            WHERE preview."ownerId" = ${ownerId}
              AND preview."assetId" = asset.id
              AND preview.revision = asset."mediaRevision"
              AND preview.kind = 'PREVIEW'
              AND preview.status = 'READY'
          )
      `),
    ]);
    const countJobs = (status: string) =>
      embeddingJobs.find((row) => row.status === status)?._count ?? 0;
    const queued = countJobs('PENDING');
    const running = countJobs('PROCESSING');
    const failedJobs = countJobs('FAILED');
    const effectiveFailed = Math.max(failed, failedJobs);
    const processable = processableRows[0]?.count ?? 0;
    return {
      model: EAGLE_EMBEDDING_MODEL,
      dimensions: EAGLE_EMBEDDING_DIMENSIONS,
      embeddingCoverage: {
        eligible,
        ready,
        failed: effectiveFailed,
        queued,
        running,
        missing: Math.max(0, processable - ready - effectiveFailed - queued - running),
        blocked: Math.max(0, eligible - processable),
        processing: queued + running,
        percentage: eligible ? Math.round((ready / eligible) * 1_000) / 10 : 100,
      },
      processingSchedule: {
        mode: processingSetting?.mode ?? 'NIGHT',
        nightStart: processingSetting?.nightStart ?? '23:00',
        nightEnd: processingSetting?.nightEnd ?? '06:00',
        timeZone: 'Asia/Shanghai' as const,
      },
      tags: { enabled: enabledTags, ready: readyTags, awaitingCenter: enabledTags - readyTags },
      suggestions: { unclassified, pending: pendingSuggestions },
      host,
      refreshedAt: new Date().toISOString(),
    };
  }

  async retryFailedEmbeddings(ownerId: string) {
    const result = await this.prisma.eagleAssetProcessingJob.updateMany({
      where: { ownerId, kind: 'GENERATE_EMBEDDING', status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        startedAt: null,
        completedAt: null,
        lockedAt: null,
        lastError: null,
      },
    });
    return { retried: result.count };
  }

  async scanMissingEmbeddings(ownerId: string) {
    const [repaired, created] = await this.prisma.$transaction(
      async (transaction) => {
        const repairedCount = await transaction.$executeRaw(Prisma.sql`
        UPDATE "EagleMediaJob" AS job
        SET status = 'PENDING', attempts = 0, "availableAt" = CURRENT_TIMESTAMP,
            "lockedAt" = NULL, "startedAt" = NULL, "completedAt" = NULL,
            "lastError" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        FROM "EagleAsset" AS asset
        WHERE job."ownerId" = ${ownerId}
          AND asset."ownerId" = ${ownerId}
          AND asset.id = job."assetId"
          AND asset."deletedAt" IS NULL
          AND asset."mimeType" LIKE 'image/%'
          AND asset."mediaRevision" = job."assetRevision"
          AND job.kind = 'GENERATE_EMBEDDING'
          AND job."processorVersion" = ${EMBEDDING_PROCESSOR_VERSION}
          AND job.status = 'COMPLETED'
          AND NOT EXISTS (
            SELECT 1
            FROM "EagleAssetEmbedding" AS embedding
            WHERE embedding."ownerId" = ${ownerId}
              AND embedding."assetId" = asset.id
              AND embedding."assetRevision" = asset."mediaRevision"
              AND embedding."isCurrent" = true
              AND embedding.status = 'READY'
          )
      `);
        const createdCount = await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "EagleMediaJob" (
          id, "ownerId", "assetId", kind, status, lane, "assetRevision",
          "processorVersion", "dependsOnJobId", "createdAt", "updatedAt"
        )
        SELECT gen_random_uuid()::text, asset."ownerId", asset.id,
          'GENERATE_EMBEDDING'::"EagleMediaJobKind", 'PENDING'::"EagleMediaJobStatus",
          'BACKGROUND'::"EagleProcessingLane", asset."mediaRevision",
          ${EMBEDDING_PROCESSOR_VERSION}, dependency.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        FROM "EagleAsset" AS asset
        JOIN LATERAL (
          SELECT rendition.id
          FROM "EagleMediaJob" AS rendition
          WHERE rendition."ownerId" = ${ownerId}
            AND rendition."assetId" = asset.id
            AND rendition."assetRevision" = asset."mediaRevision"
            AND rendition.kind = 'GENERATE_RENDITIONS'
            AND rendition."processorVersion" = ${RENDITION_PROCESSOR_VERSION}
            AND rendition.status = 'COMPLETED'
          ORDER BY rendition."completedAt" DESC NULLS LAST, rendition.id
          LIMIT 1
        ) AS dependency ON true
        WHERE asset."ownerId" = ${ownerId}
          AND asset."deletedAt" IS NULL
          AND asset."mimeType" LIKE 'image/%'
          AND EXISTS (
            SELECT 1 FROM "EagleAssetRendition" AS preview
            WHERE preview."ownerId" = ${ownerId}
              AND preview."assetId" = asset.id
              AND preview.revision = asset."mediaRevision"
              AND preview.kind = 'PREVIEW'
              AND preview.status = 'READY'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "EagleMediaJob" AS existing
            WHERE existing."assetId" = asset.id
              AND existing."assetRevision" = asset."mediaRevision"
              AND existing.kind = 'GENERATE_EMBEDDING'
              AND existing."processorVersion" = ${EMBEDDING_PROCESSOR_VERSION}
          )
        ON CONFLICT ("assetId", kind, "assetRevision", "processorVersion") DO NOTHING
      `);
        return [repairedCount, createdCount] as const;
      },
      { timeout: 60_000 },
    );
    return { scanned: repaired + created, created, repaired };
  }

  private async checkEmbeddingHost() {
    const baseUrl = process.env.MLX_EMBEDDING_URL?.replace(/\/+$/, '');
    const token = process.env.MLX_EMBEDDING_TOKEN;
    if (!baseUrl || !token) return { status: 'NOT_CONFIGURED' as const };
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return { status: 'OFFLINE' as const };
      const payload = (await response.json()) as {
        status?: unknown;
        model?: unknown;
        revision?: unknown;
        dimensions?: unknown;
        metal?: unknown;
      };
      const matchesContract =
        payload.status === 'ready' &&
        payload.model === EAGLE_EMBEDDING_MODEL &&
        payload.dimensions === EAGLE_EMBEDDING_DIMENSIONS &&
        payload.metal === true;
      return {
        status: matchesContract ? ('ONLINE' as const) : ('DRIFTED' as const),
        model: typeof payload.model === 'string' ? payload.model : null,
        revision: typeof payload.revision === 'string' ? payload.revision : null,
        dimensions: typeof payload.dimensions === 'number' ? payload.dimensions : null,
        metal: payload.metal === true,
      };
    } catch {
      return { status: 'OFFLINE' as const };
    }
  }

  async listTagSemantics(ownerId: string, query?: string, includePrivate = false) {
    const visibleAsset = includePrivate ? {} : { isPrivate: false };
    const normalizedQuery = query?.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    const where: Prisma.EagleManualTagWhereInput = normalizedQuery
      ? {
          ownerId,
          normalizedName: { contains: normalizedQuery },
          OR: [
            { semanticConfig: { is: null } },
            { semanticConfig: { is: { recommendationEnabled: false } } },
          ],
        }
      : { ownerId, semanticConfig: { is: { recommendationEnabled: true } } };
    const tags = await this.prisma.eagleManualTag.findMany({
      where,
      orderBy: [{ isStarred: 'desc' }, { normalizedName: 'asc' }],
      ...(normalizedQuery ? { take: 20 } : {}),
      select: {
        id: true,
        name: true,
        color: true,
        semanticConfig: true,
        prototypeSnapshots: {
          where: { isCurrent: true, status: 'ACTIVE' },
          take: 1,
          select: {
            id: true,
            version: true,
            sourceAssetCount: true,
            addedMemberCount: true,
            removedMemberCount: true,
            activatedAt: true,
            _count: { select: { prototypes: true } },
          },
        },
        semanticBuilds: {
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, createdAt: true },
        },
        _count: {
          select: {
            assetLinks: { where: { asset: { deletedAt: null, ...visibleAsset } } },
            vectorSuggestions: {
              where: {
                status: 'PENDING',
                isActive: true,
                invalidatedAt: null,
                asset: { deletedAt: null, manualTagLinks: { none: {} }, ...visibleAsset },
              },
            },
          },
        },
      },
    });
    return tags.map(({ semanticConfig, semanticBuilds, prototypeSnapshots, _count, ...tag }) => ({
      ...tag,
      assetCount: _count.assetLinks,
      pendingSuggestionCount: _count.vectorSuggestions,
      recommendationEnabled: semanticConfig?.recommendationEnabled ?? false,
      currentSnapshotId: semanticConfig?.currentSnapshotId ?? null,
      lastGeneratedAt: semanticConfig?.lastGeneratedAt ?? null,
      activeBuild: semanticBuilds[0] ?? null,
      currentSnapshot: prototypeSnapshots[0]
        ? {
            ...prototypeSnapshots[0],
            centerCount: prototypeSnapshots[0]._count.prototypes,
            _count: undefined,
          }
        : null,
    }));
  }

  async setRecommendationEnabled(ownerId: string, tagId: string, enabled: boolean) {
    return this.prisma.$transaction(async (transaction) => {
      const tag = await transaction.eagleManualTag.findFirst({
        where: { ownerId, id: tagId },
        select: { id: true },
      });
      if (!tag) throw new NotFoundException('标签不存在。');
      const config = await transaction.eagleManualTagSemanticConfig.upsert({
        where: { ownerId_tagId: { ownerId, tagId } },
        create: { ownerId, tagId, recommendationEnabled: enabled },
        update: { recommendationEnabled: enabled },
        select: { recommendationEnabled: true, currentSnapshotId: true },
      });
      let invalidated = 0;
      if (!enabled) {
        const result = await transaction.eagleVectorTagSuggestion.updateMany({
          where: {
            ownerId,
            suggestedTagId: tagId,
            status: 'PENDING',
            isActive: true,
            invalidatedAt: null,
          },
          data: {
            isActive: false,
            invalidatedAt: new Date(),
            invalidReason: 'TAG_RECOMMENDATION_DISABLED',
          },
        });
        invalidated = result.count;
      } else if (config.currentSnapshotId) {
        const activeGeneration = await transaction.eagleTagSemanticBuild.findFirst({
          where: {
            ownerId,
            tagId,
            operation: 'RECOMPUTE_SUGGESTIONS',
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          select: { id: true },
        });
        if (!activeGeneration) {
          await transaction.eagleTagSemanticBuild.create({
            data: { ownerId, tagId, operation: 'RECOMPUTE_SUGGESTIONS' },
          });
        }
      }
      return { tagId, recommendationEnabled: enabled, invalidated };
    });
  }

  async requestTagRebuild(ownerId: string, tagId: string) {
    const [tag, config, activeBuild] = await Promise.all([
      this.prisma.eagleManualTag.findFirst({
        where: { ownerId, id: tagId },
        select: {
          id: true,
          _count: { select: { assetLinks: { where: { asset: { deletedAt: null } } } } },
        },
      }),
      this.prisma.eagleManualTagSemanticConfig.findUnique({
        where: { ownerId_tagId: { ownerId, tagId } },
        select: { recommendationEnabled: true },
      }),
      this.prisma.eagleTagSemanticBuild.findFirst({
        where: { ownerId, tagId, status: { in: ['PENDING', 'PROCESSING'] } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!tag) throw new NotFoundException('标签不存在。');
    if (!config?.recommendationEnabled) throw new BadRequestException('请先开启该标签的智能推荐。');
    if (!tag._count.assetLinks)
      throw new BadRequestException('标签没有可用图片，无法生成向量中心。');
    if (activeBuild) return activeBuild;
    return this.prisma.eagleTagSemanticBuild.create({
      data: { ownerId, tagId, operation: 'REBUILD_CENTER', status: 'PENDING' },
    });
  }

  async listSuggestions(ownerId: string, query: ListVectorSuggestionsDto, includePrivate = false) {
    const visibleAsset = includePrivate ? {} : { isPrivate: false };
    const limit = query.limit ?? 40;
    const rows = await this.prisma.eagleVectorTagSuggestion.findMany({
      where: {
        ownerId,
        suggestedTagId: query.tagId,
        status: 'PENDING',
        isActive: true,
        invalidatedAt: null,
        asset: { deletedAt: null, manualTagLinks: { none: {} }, ...visibleAsset },
      },
      orderBy:
        query.sort === 'NEWEST'
          ? [{ createdAt: 'desc' }, { id: 'desc' }]
          : [{ score: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        suggestedTag: { select: { id: true, name: true, color: true } },
        asset: {
          select: {
            id: true,
            displayName: true,
            width: true,
            height: true,
            renditions: {
              where: { status: 'READY', kind: 'THUMBNAIL', variant: '512' },
              orderBy: { revision: 'desc' },
              take: 1,
              select: { id: true, width: true, height: true },
            },
          },
        },
      },
    });
    const items = rows.slice(0, limit);
    const prototypeKeys = [
      ...new Map(
        items.map((item) => [
          `${item.snapshotId}:${item.prototypeRank}`,
          { snapshotId: item.snapshotId, rank: item.prototypeRank },
        ]),
      ).values(),
    ];
    const prototypes = prototypeKeys.length
      ? await this.prisma.eagleTagPrototype.findMany({
          where: { ownerId, OR: prototypeKeys },
          select: { snapshotId: true, rank: true, representativeAssetIds: true },
        })
      : [];
    const representativeIds = [
      ...new Set(prototypes.flatMap((prototype) => prototype.representativeAssetIds.slice(0, 4))),
    ];
    const representativeAssets = representativeIds.length
      ? await this.prisma.eagleAsset.findMany({
          where: { ownerId, id: { in: representativeIds }, deletedAt: null, ...visibleAsset },
          select: {
            id: true,
            displayName: true,
            width: true,
            height: true,
            renditions: {
              where: { status: 'READY', kind: 'THUMBNAIL', variant: '256' },
              orderBy: { revision: 'desc' },
              take: 1,
              select: { id: true, width: true, height: true },
            },
          },
        })
      : [];
    const assetById = new Map(representativeAssets.map((asset) => [asset.id, asset]));
    const representativeIdsByPrototype = new Map(
      prototypes.map((prototype) => [
        `${prototype.snapshotId}:${prototype.rank}`,
        prototype.representativeAssetIds,
      ]),
    );
    return {
      items: items.map((item) => ({
        ...item,
        representativeAssets: (
          representativeIdsByPrototype.get(`${item.snapshotId}:${item.prototypeRank}`) ?? []
        )
          .map((assetId) => assetById.get(assetId))
          .filter((asset) => asset !== undefined),
      })),
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listUnclassified(
    ownerId: string,
    query: ListUnclassifiedVectorAssetsDto,
    includePrivate = false,
  ) {
    const limit = query.limit ?? 40;
    const rows = await this.prisma.eagleAsset.findMany({
      where: {
        ownerId,
        deletedAt: null,
        ...(includePrivate ? {} : { isPrivate: false }),
        manualTagLinks: { none: {} },
        vectorSuggestions: {
          none: { status: 'PENDING', isActive: true, invalidatedAt: null },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        displayName: true,
        width: true,
        height: true,
        embeddings: {
          where: { isCurrent: true },
          take: 1,
          select: { status: true, errorCode: true },
        },
        renditions: {
          where: { status: 'READY', kind: 'THUMBNAIL', variant: '512' },
          orderBy: { revision: 'desc' },
          take: 1,
          select: { id: true, width: true, height: true },
        },
      },
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }

  async reviewSuggestion(
    ownerId: string,
    suggestionId: string,
    action: 'ACCEPT' | 'REJECT',
    includePrivate = false,
  ) {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const suggestion = await transaction.eagleVectorTagSuggestion.findFirst({
        where: {
          ownerId,
          id: suggestionId,
          status: 'PENDING',
          isActive: true,
          invalidatedAt: null,
          asset: includePrivate ? {} : { isPrivate: false },
        },
        include: {
          embedding: { select: { isCurrent: true, status: true } },
          snapshot: { select: { isCurrent: true, status: true } },
          suggestedTag: {
            select: { semanticConfig: { select: { recommendationEnabled: true } } },
          },
        },
      });
      if (!suggestion) throw new NotFoundException('待审核建议不存在。');
      if (action === 'REJECT') {
        const updated = await transaction.eagleVectorTagSuggestion.updateMany({
          where: {
            ownerId,
            id: suggestionId,
            status: 'PENDING',
            isActive: true,
            invalidatedAt: null,
          },
          data: { status: 'REJECTED', reviewedAt: new Date(), reviewedByUserId: ownerId },
        });
        if (updated.count !== 1) throw new ConflictException('建议已被处理。');
        return { id: suggestion.id, status: 'REJECTED' as const, assetId: suggestion.assetId };
      }
      const manualTagCount = await transaction.eagleAssetManualTag.count({
        where: { ownerId, assetId: suggestion.assetId },
      });
      const remainsValid =
        manualTagCount === 0 &&
        suggestion.embedding.isCurrent &&
        suggestion.embedding.status === 'READY' &&
        suggestion.snapshot.isCurrent &&
        suggestion.snapshot.status === 'ACTIVE' &&
        suggestion.suggestedTag.semanticConfig?.recommendationEnabled === true;
      if (!remainsValid) {
        await transaction.eagleVectorTagSuggestion.updateMany({
          where: {
            ownerId,
            id: suggestionId,
            status: 'PENDING',
            isActive: true,
            invalidatedAt: null,
          },
          data: {
            isActive: false,
            invalidatedAt: new Date(),
            invalidReason: 'SUGGESTION_NO_LONGER_APPLICABLE',
          },
        });
        return { invalid: true as const };
      }
      await transaction.eagleAssetManualTag.upsert({
        where: {
          ownerId_assetId_tagId: {
            ownerId,
            assetId: suggestion.assetId,
            tagId: suggestion.suggestedTagId,
          },
        },
        create: {
          ownerId,
          assetId: suggestion.assetId,
          tagId: suggestion.suggestedTagId,
          assignedByUser: true,
          assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
          acceptedSuggestionId: suggestion.id,
        },
        update: {
          assignedByUser: true,
          assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
          acceptedSuggestionId: suggestion.id,
        },
      });
      await upsertAcceptedSuggestionMemberDistance(transaction, {
        ownerId,
        tagId: suggestion.suggestedTagId,
        assetId: suggestion.assetId,
        snapshotId: suggestion.snapshotId,
        embeddingId: suggestion.embeddingId,
      });
      const updated = await transaction.eagleVectorTagSuggestion.updateMany({
        where: {
          ownerId,
          id: suggestionId,
          status: 'PENDING',
          isActive: true,
          invalidatedAt: null,
        },
        data: { status: 'ACCEPTED', reviewedAt: new Date(), reviewedByUserId: ownerId },
      });
      if (updated.count !== 1) throw new ConflictException('建议已被处理。');
      return { id: suggestion.id, status: 'ACCEPTED' as const, assetId: suggestion.assetId };
    });
    if ('invalid' in outcome) throw new ConflictException('图片或标签状态已变化，请刷新。');
    return outcome;
  }

  async reviewSuggestions(
    ownerId: string,
    suggestionIds: string[],
    action: 'ACCEPT' | 'REJECT',
    includePrivate = false,
  ) {
    const results = [];
    for (const suggestionId of suggestionIds) {
      results.push(await this.reviewSuggestion(ownerId, suggestionId, action, includePrivate));
    }
    return { items: results };
  }

  async listTagDistanceAssets(
    ownerId: string,
    tagId: string,
    query: ListTagDistanceAssetsDto,
    includePrivate = false,
  ) {
    const tag = await this.prisma.eagleManualTag.findFirst({
      where: { ownerId, id: tagId },
      select: { semanticConfig: { select: { currentSnapshotId: true } } },
    });
    if (!tag) throw new NotFoundException('标签不存在。');
    const snapshotId = tag.semanticConfig?.currentSnapshotId;
    if (!snapshotId) throw new BadRequestException('标签尚未建立向量中心。');
    const cursor = query.cursor ? decodeDistanceCursor(query.cursor) : null;
    const direction = query.direction ?? 'DESC';
    const comparison = direction === 'DESC' ? 'lt' : 'gt';
    const where: Prisma.EagleTagMemberDistanceWhereInput = {
      ownerId,
      tagId,
      snapshotId,
      asset: { deletedAt: null, ...(includePrivate ? {} : { isPrivate: false }) },
      ...(cursor
        ? {
            OR: [
              { distance: { [comparison]: cursor.distance } },
              { distance: cursor.distance, assetId: { [comparison]: cursor.assetId } },
            ],
          }
        : {}),
    };
    const limit = query.limit ?? 40;
    const rows = await this.prisma.eagleTagMemberDistance.findMany({
      where,
      orderBy: [
        { distance: direction === 'DESC' ? 'desc' : 'asc' },
        { assetId: direction === 'DESC' ? 'desc' : 'asc' },
      ],
      take: limit + 1,
      include: { asset: { select: { id: true, displayName: true, width: true, height: true } } },
    });
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ distance: last.distance, assetId: last.assetId }),
            ).toString('base64url')
          : null,
    };
  }
}

function decodeDistanceCursor(value: string): { distance: number; assetId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('distance' in parsed) ||
      typeof parsed.distance !== 'number' ||
      !Number.isFinite(parsed.distance) ||
      !('assetId' in parsed) ||
      typeof parsed.assetId !== 'string'
    )
      throw new Error('invalid');
    return { distance: parsed.distance, assetId: parsed.assetId };
  } catch {
    throw new BadRequestException('向量距离游标无效。');
  }
}
