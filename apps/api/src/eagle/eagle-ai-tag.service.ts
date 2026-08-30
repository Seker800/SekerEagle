import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EAGLE_AI_TAG_DEFAULT_MODEL,
  EAGLE_AI_TAG_PROCESSOR_VERSION,
  EAGLE_AI_TAG_PROMPT_VERSION,
} from '@sekereagle/config';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateEagleAiTagSettingsDto } from './eagle-ai-tag.dto';
import { EagleEmbeddingClient } from './eagle-embedding-client';

export const AI_TAG_EMBEDDING_SPACE_ID =
  process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1';

export interface EagleAiTagSearchMatch {
  id: string;
  name: string;
  match: 'EXACT' | 'SEMANTIC';
  similarity: number;
}

@Injectable()
export class EagleAiTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EagleEmbeddingClient,
  ) {}

  async summary(ownerId: string, includePrivate = false) {
    const visibleAsset = includePrivate ? {} : { isPrivate: false };
    const [eligible, analyzed, queued, running, failed, tags, ollama, settings] = await Promise.all(
      [
        this.prisma.eagleAsset.count({
          where: { ownerId, deletedAt: null, mimeType: { startsWith: 'image/' }, ...visibleAsset },
        }),
        this.prisma.eagleAiAnalysisRun.count({
          where: {
            ownerId,
            status: 'SUCCEEDED',
            provider: 'OLLAMA',
            promptVersion: EAGLE_AI_TAG_PROMPT_VERSION,
            asset: { deletedAt: null, ...visibleAsset },
          },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: {
            ownerId,
            kind: 'GENERATE_AI_TAGS',
            processorVersion: EAGLE_AI_TAG_PROCESSOR_VERSION,
            status: 'PENDING',
            asset: visibleAsset,
          },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: {
            ownerId,
            kind: 'GENERATE_AI_TAGS',
            processorVersion: EAGLE_AI_TAG_PROCESSOR_VERSION,
            status: 'PROCESSING',
            asset: visibleAsset,
          },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: {
            ownerId,
            kind: 'GENERATE_AI_TAGS',
            processorVersion: EAGLE_AI_TAG_PROCESSOR_VERSION,
            status: 'FAILED',
            asset: visibleAsset,
          },
        }),
        this.prisma.eagleAiTag.count({ where: { ownerId } }),
        this.checkOllama(),
        this.getSettings(ownerId),
      ],
    );
    return { eligible, analyzed, queued, running, failed, tags, ollama, settings };
  }

  async updateSettings(ownerId: string, input: UpdateEagleAiTagSettingsDto) {
    const row = await this.prisma.eagleProcessingSetting.upsert({
      where: { ownerId },
      create: {
        ownerId,
        aiTagManualEnabled: input.manualEnabled,
        aiTagScheduleEnabled: input.scheduleEnabled,
        aiTagScheduleStart: input.scheduleStart,
        aiTagScheduleEnd: input.scheduleEnd,
      },
      update: {
        aiTagManualEnabled: input.manualEnabled,
        aiTagScheduleEnabled: input.scheduleEnabled,
        aiTagScheduleStart: input.scheduleStart,
        aiTagScheduleEnd: input.scheduleEnd,
      },
    });
    return serializeSettings(row);
  }

  async scanMissing(ownerId: string, includePrivate = false) {
    const privateClause = includePrivate ? Prisma.empty : Prisma.sql`AND asset."isPrivate" = false`;
    const created = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "EagleMediaJob" (
        id, "ownerId", "assetId", kind, status, lane, "assetRevision", "processorVersion",
        attempts, "leaseVersion", "availableAt", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid(), asset."ownerId", asset.id, 'GENERATE_AI_TAGS'::"EagleMediaJobKind",
        'PENDING'::"EagleMediaJobStatus", 'BACKGROUND'::"EagleProcessingLane",
        asset."mediaRevision", ${EAGLE_AI_TAG_PROCESSOR_VERSION}, 0, 0, now(), now(), now()
      FROM "EagleAsset" AS asset
      WHERE asset."ownerId" = ${ownerId}
        AND asset."deletedAt" IS NULL
        AND asset."mimeType" LIKE 'image/%'
        ${privateClause}
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
            AND existing.kind = 'GENERATE_AI_TAGS'
            AND existing."processorVersion" = ${EAGLE_AI_TAG_PROCESSOR_VERSION}
        )
      ON CONFLICT ("assetId", kind, "assetRevision", "processorVersion") DO NOTHING
    `);
    return { created };
  }

  async retryFailed(ownerId: string, includePrivate = false) {
    const result = await this.prisma.eagleAssetProcessingJob.updateMany({
      where: {
        ownerId,
        kind: 'GENERATE_AI_TAGS',
        processorVersion: EAGLE_AI_TAG_PROCESSOR_VERSION,
        status: 'FAILED',
        asset: includePrivate ? {} : { isPrivate: false },
      },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
    });
    return { retried: result.count };
  }

  async resolveSearchTags(ownerId: string, query: string): Promise<EagleAiTagSearchMatch[]> {
    const normalizedName = query.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
    if (!normalizedName) return [];
    const exact = await this.prisma.eagleAiTag.findFirst({
      where: { ownerId, normalizedName },
      select: { id: true, name: true },
    });
    let semantic: Array<{ id: string; name: string; similarity: number }> = [];
    try {
      const { embedding } = await this.embeddings.embedText(
        `图片中的具体物体、场所或内容类型：${normalizedName}`,
      );
      const vector = `[${embedding.join(',')}]`;
      const threshold = boundedSimilarity(process.env.EAGLE_AI_TAG_SEARCH_MINIMUM_SIMILARITY, 0.78);
      semantic = await this.prisma.$queryRaw(Prisma.sql`
        SELECT id, name, (1 - (embedding <=> ${vector}::vector))::double precision AS similarity
        FROM "EagleAiTag"
        WHERE "ownerId" = ${ownerId}
          AND "embeddingSpaceId" = ${AI_TAG_EMBEDDING_SPACE_ID}
          AND embedding IS NOT NULL
          ${exact ? Prisma.sql`AND id <> ${exact.id}` : Prisma.empty}
          AND 1 - (embedding <=> ${vector}::vector) >= ${threshold}
        ORDER BY embedding <=> ${vector}::vector, id
        LIMIT 7
      `);
    } catch {
      // Exact matching remains available while the local embedding host is offline.
    }
    return [
      ...(exact ? [{ ...exact, match: 'EXACT' as const, similarity: 1 }] : []),
      ...semantic.map((tag) => ({ ...tag, match: 'SEMANTIC' as const })),
    ];
  }

  private async checkOllama() {
    const baseUrl = (process.env.OLLAMA_URL ?? 'http://host.docker.internal:11434').replace(
      /\/+$/,
      '',
    );
    const model = process.env.OLLAMA_VISION_MODEL ?? EAGLE_AI_TAG_DEFAULT_MODEL;
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (!response.ok) return { status: 'OFFLINE' as const, model };
      const payload = (await response.json()) as {
        models?: Array<{ name?: unknown; model?: unknown }>;
      };
      const installed = (payload.models ?? []).some(
        (entry) => entry.name === model || entry.model === model,
      );
      return { status: installed ? ('ONLINE' as const) : ('MODEL_MISSING' as const), model };
    } catch {
      return { status: 'OFFLINE' as const, model };
    }
  }

  private async getSettings(ownerId: string) {
    const row = await this.prisma.eagleProcessingSetting.findUnique({ where: { ownerId } });
    return serializeSettings(row);
  }
}

function serializeSettings(
  row: {
    aiTagManualEnabled: boolean;
    aiTagScheduleEnabled: boolean;
    aiTagScheduleStart: string;
    aiTagScheduleEnd: string;
  } | null,
) {
  return {
    manualEnabled: row?.aiTagManualEnabled ?? false,
    scheduleEnabled: row?.aiTagScheduleEnabled ?? false,
    scheduleStart: row?.aiTagScheduleStart ?? '23:00',
    scheduleEnd: row?.aiTagScheduleEnd ?? '06:00',
    timeZone: 'Asia/Shanghai' as const,
  };
}

function boundedSimilarity(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(0.99, Math.max(0.5, parsed)) : fallback;
}
