import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EagleVectorSuggestionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListTagDistanceAssetsDto,
  ListUnclassifiedVectorAssetsDto,
  ListVectorSuggestionsDto,
} from './eagle-vector.dto';
import { EAGLE_EMBEDDING_DIMENSIONS, EAGLE_EMBEDDING_MODEL } from './eagle-vector-semantics';

@Injectable()
export class EagleVectorService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string) {
    const [
      eligible,
      ready,
      failed,
      enabledTags,
      readyTags,
      unclassified,
      pendingSuggestions,
      host,
    ] = await Promise.all([
      this.prisma.eagleAsset.count({
        where: { ownerId, deletedAt: null, mimeType: { startsWith: 'image/' } },
      }),
      this.prisma.eagleAssetEmbedding.count({
        where: { ownerId, isCurrent: true, status: 'READY', asset: { deletedAt: null } },
      }),
      this.prisma.eagleAssetEmbedding.count({
        where: { ownerId, isCurrent: true, status: 'FAILED', asset: { deletedAt: null } },
      }),
      this.prisma.eagleManualTagSemanticConfig.count({
        where: { ownerId, recommendationEnabled: true },
      }),
      this.prisma.eagleManualTagSemanticConfig.count({
        where: { ownerId, recommendationEnabled: true, currentSnapshotId: { not: null } },
      }),
      this.prisma.eagleAsset.count({
        where: { ownerId, deletedAt: null, manualTagLinks: { none: {} } },
      }),
      this.prisma.eagleVectorTagSuggestion.count({
        where: { ownerId, status: 'PENDING', isActive: true, invalidatedAt: null },
      }),
      this.checkEmbeddingHost(),
    ]);
    return {
      model: EAGLE_EMBEDDING_MODEL,
      dimensions: EAGLE_EMBEDDING_DIMENSIONS,
      embeddingCoverage: {
        eligible,
        ready,
        failed,
        processing: Math.max(0, eligible - ready - failed),
        percentage: eligible ? Math.round((ready / eligible) * 100) : 100,
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

  async listTagSemantics(ownerId: string) {
    const tags = await this.prisma.eagleManualTag.findMany({
      where: { ownerId },
      orderBy: [{ isStarred: 'desc' }, { normalizedName: 'asc' }],
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
        _count: { select: { assetLinks: { where: { asset: { deletedAt: null } } } } },
      },
    });
    return tags.map(({ semanticConfig, semanticBuilds, prototypeSnapshots, _count, ...tag }) => ({
      ...tag,
      assetCount: _count.assetLinks,
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

  async listSuggestions(ownerId: string, query: ListVectorSuggestionsDto) {
    const limit = query.limit ?? 40;
    const rows = await this.prisma.eagleVectorTagSuggestion.findMany({
      where: {
        ownerId,
        suggestedTagId: query.tagId,
        status: 'PENDING',
        isActive: true,
        invalidatedAt: null,
        asset: { deletedAt: null, manualTagLinks: { none: {} } },
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
    return {
      items,
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listUnclassified(ownerId: string, query: ListUnclassifiedVectorAssetsDto) {
    const limit = query.limit ?? 40;
    const rows = await this.prisma.eagleAsset.findMany({
      where: {
        ownerId,
        deletedAt: null,
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

  async reviewSuggestion(ownerId: string, suggestionId: string, action: 'ACCEPT' | 'REJECT') {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const suggestion = await transaction.eagleVectorTagSuggestion.findFirst({
        where: {
          ownerId,
          id: suggestionId,
          status: 'PENDING',
          isActive: true,
          invalidatedAt: null,
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
      await transaction.$executeRaw(
        Prisma.sql`
          INSERT INTO "EagleTagMemberDistance" (
            "ownerId", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
          )
          SELECT ${ownerId}, ${suggestion.suggestedTagId}, ${suggestion.assetId},
                 prototype."snapshotId", prototype.embedding <=> embedding.embedding,
                 prototype.rank, NOW()
          FROM "EagleAssetEmbedding" embedding
          CROSS JOIN LATERAL (
            SELECT candidate."snapshotId", candidate.rank, candidate.embedding
            FROM "EagleTagPrototype" candidate
            WHERE candidate."ownerId" = ${ownerId}
              AND candidate."snapshotId" = ${suggestion.snapshotId}
            ORDER BY candidate.embedding <=> embedding.embedding
            LIMIT 1
          ) prototype
          WHERE embedding."ownerId" = ${ownerId} AND embedding.id = ${suggestion.embeddingId}
          ON CONFLICT ("ownerId", "tagId", "assetId", "snapshotId") DO NOTHING
        `,
      );
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

  async reviewSuggestions(ownerId: string, suggestionIds: string[], action: 'ACCEPT' | 'REJECT') {
    const results = [];
    for (const suggestionId of suggestionIds) {
      results.push(await this.reviewSuggestion(ownerId, suggestionId, action));
    }
    return { items: results };
  }

  async listTagDistanceAssets(ownerId: string, tagId: string, query: ListTagDistanceAssetsDto) {
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
      asset: { deletedAt: null },
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
