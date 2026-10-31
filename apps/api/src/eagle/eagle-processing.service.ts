import { PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION } from '@sekereagle/library-core';
import { mediaBlocksAssetReadySql } from '@sekereagle/library-persistence';
import { mediaRequeueData, mediaTaskBlocksAssetReady } from '@sekereagle/library-core';
import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE, inLibrary } from './library-mode';
import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListEagleProcessingJobsDto,
  UpdateEagleProcessingSettingsDto,
} from './eagle-processing.dto';
import { COLOR_PROCESSOR_VERSION } from './eagle-color-search';
import { buildMissingImageProcessingJobs } from './media-job-plan';
import { readMediaProcessingFacts } from './media-processing-facts';

@Injectable()
export class EagleProcessingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}

  async summary(ownerId: string, includePrivate = false) {
    const visibleAsset = {
      deletedAt: null,
      ...(includePrivate ? {} : { isPrivate: false as const }),
    };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const onlineSince = new Date(Date.now() - 45_000);
    const [workers, jobCounts, coverage, settings] = await Promise.all([
      this.prisma.eagleProcessingWorkerHeartbeat.findMany({
        where: { heartbeatAt: { gte: onlineSince } },
      }),
      this.prisma.$queryRaw<
        Array<{ lane: string; status: string; count: bigint; recent: bigint }>
      >(Prisma.sql`
          SELECT j.lane::text,j.status::text,count(*) AS count,
            count(*) FILTER (WHERE j."completedAt">=${since}) AS recent
          FROM "EagleMediaJob" j JOIN "EagleAsset" a ON a.id=j."assetId" AND a."ownerId"=j."ownerId" AND a."libraryMode"=j."libraryMode"
          WHERE j."ownerId"=${ownerId} AND j."libraryMode"=${this.libraryMode}::"LibraryMode"
            AND j.kind<>'GENERATE_AI_TAGS' AND j."assetRevision"=a."mediaRevision"
            AND (a."deletedAt" IS NULL OR j.kind='PURGE_ASSET') AND (${includePrivate} OR NOT a."isPrivate")
          GROUP BY j.lane,j.status
        `),
      this.prisma.eagleAssetColorAnalysis.groupBy({
        by: ['status'],
        where: {
          ownerId,
          isCurrent: true,
          asset: visibleAsset,
          libraryMode: this.libraryMode,
        },
        _count: true,
      }),
      this.getSettings(ownerId),
    ]);
    const grouped = jobCounts.map((row) => ({
      lane: row.lane,
      status: row.status,
      _count: Number(row.count),
    }));
    const countJobs = (status: string) =>
      jobCounts.filter((row) => row.status === status).reduce((n, row) => n + Number(row.count), 0);
    const running = countJobs('PROCESSING'),
      queued = countJobs('PENDING'),
      failed = countJobs('FAILED');
    const completedLast24Hours = jobCounts
      .filter((row) => row.status === 'COMPLETED')
      .reduce((n, row) => n + Number(row.recent), 0);
    const countColor = (status: string) =>
      coverage.find((row) => row.status === status)?._count ?? 0;
    const eligible = await this.prisma.eagleAsset.count({
      where: {
        ownerId,
        mimeType: { startsWith: 'image/' },
        ...visibleAsset,
        libraryMode: this.libraryMode,
      },
    });
    const completed = countColor('COMPLETED');
    return {
      worker: {
        status: workers.length ? 'ONLINE' : 'OFFLINE',
        count: workers.length,
        activeJobCount: workers.reduce((sum, worker) => sum + worker.activeJobCount, 0),
        lastHeartbeatAt: workers[0]?.heartbeatAt ?? null,
        version: workers[0]?.version ?? null,
      },
      counts: { running, queued, failed, completedLast24Hours },
      queues: ['INTERACTIVE', 'BACKGROUND', 'MAINTENANCE'].map((lane) => ({
        lane,
        queued: groupCount(grouped, lane, 'PENDING'),
        running: groupCount(grouped, lane, 'PROCESSING'),
        failed: groupCount(grouped, lane, 'FAILED'),
      })),
      colorCoverage: {
        processorVersion: COLOR_PROCESSOR_VERSION,
        eligible,
        completed,
        processing: countColor('RUNNING') + countColor('PENDING'),
        failed: countColor('FAILED'),
        percentage: eligible ? Math.round((completed / eligible) * 100) : 100,
      },
      settings,
      refreshedAt: new Date().toISOString(),
    };
  }

  async jobs(ownerId: string, query: ListEagleProcessingJobsDto, includePrivate = false) {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.eagleAssetProcessingJob.findMany({
      where: {
        ownerId,
        status: query.status,
        lane: query.lane,
        kind: query.kind ?? { not: 'GENERATE_AI_TAGS' },
        asset: includePrivate ? {} : { isPrivate: false },
        libraryMode: this.libraryMode,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { asset: { select: { displayName: true } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ asset, ...job }) => ({
        id: job.id,
        assetReference: asset.displayName,
        kind: job.kind,
        lane: job.lane,
        status: job.status,
        processorVersion: job.processorVersion,
        attempts: job.attempts,
        availableAt: job.availableAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        durationMs:
          job.startedAt && job.completedAt
            ? Math.max(0, job.completedAt.getTime() - job.startedAt.getTime())
            : null,
        lastError: job.lastError,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      })),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async retry(ownerId: string, jobId: string, includePrivate = false) {
    const retried = await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.eagleAssetProcessingJob.findFirst({
        where: {
          ownerId,
          id: jobId,
          status: 'FAILED',
          asset: includePrivate ? {} : { isPrivate: false },
          libraryMode: this.libraryMode,
        },
        select: {
          id: true,
          assetId: true,
          assetRevision: true,
          kind: true,
          processorVersion: true,
        },
      });
      if (!job || job.kind === 'GENERATE_AI_TAGS') return 0;
      const result = await transaction.eagleAssetProcessingJob.updateMany({
        where: {
          ownerId,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          status: 'FAILED',
          kind: { not: 'GENERATE_AI_TAGS' },
          libraryMode: this.libraryMode,
        },
        data: mediaRequeueData(),
      });
      if (result.count && mediaTaskBlocksAssetReady(job.kind, job.processorVersion)) {
        await transaction.eagleAsset.updateMany({
          where: {
            ownerId,
            id: job.assetId,
            mediaRevision: job.assetRevision,
            deletedAt: null,
            libraryMode: this.libraryMode,
          },
          data: { lifecycleStatus: 'PROCESSING', mediaErrorCode: null },
        });
      }
      return result.count;
    });
    if (!retried) throw new NotFoundException('没有可重试的处理任务。');
    return { retried };
  }
  async retryFailed(ownerId: string, includePrivate = false) {
    const retried = await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ retried: bigint }>>(Prisma.sql`
        WITH retried AS (
          UPDATE "EagleMediaJob" AS job
          SET
            "status" = 'PENDING'::"EagleMediaJobStatus",
            "attempts" = 0,
            "recoveryCount" = 0,
            "leaseVersion" = job."leaseVersion" + 1,
            "availableAt" = NOW(),
            "lockedAt" = NULL,
            "startedAt" = NULL,
            "completedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = NOW()
          FROM "EagleAsset" AS visible_asset
          WHERE job."ownerId" = ${ownerId} AND job."libraryMode" = ${this.libraryMode}::"LibraryMode"
            AND job."status" = 'FAILED'::"EagleMediaJobStatus" AND job.kind<>'GENERATE_AI_TAGS'
            AND visible_asset."ownerId" = job."ownerId"
            AND visible_asset."id" = job."assetId"
            AND (${includePrivate} OR visible_asset."isPrivate" = false)
          RETURNING job."assetId", job."assetRevision", job."kind", job."processorVersion"
        ), restored_assets AS (
          UPDATE "EagleAsset" AS asset
          SET
            "lifecycleStatus" = 'PROCESSING'::"EagleAssetLifecycleStatus",
            "mediaErrorCode" = NULL,
            "updatedAt" = NOW()
          FROM (
            SELECT DISTINCT "assetId", "assetRevision"
            FROM retried
            WHERE ${mediaBlocksAssetReadySql(Prisma.sql`"kind"`, Prisma.sql`"processorVersion"`)}
          ) AS current_job
          WHERE asset."ownerId" = ${ownerId} AND asset."libraryMode" = ${this.libraryMode}::"LibraryMode"
            AND asset."id" = current_job."assetId"
            AND asset."mediaRevision" = current_job."assetRevision"
            AND asset."deletedAt" IS NULL
          RETURNING asset."id"
        )
        SELECT COUNT(*)::bigint AS retried FROM retried
      `);
      return Number(rows[0]?.retried ?? 0n);
    });
    return { retried };
  }
  async reconcile(ownerId: string, includePrivate = false) {
    const pageSize = 500;
    const creationLimit = 500;
    let cursor: string | undefined;
    let scanned = 0;
    let created = 0;
    let missingCount = 0;
    let assetsMissingCount = 0;
    do {
      const assets = await this.prisma.eagleAsset.findMany({
        where: {
          ownerId,
          deletedAt: null,
          mimeType: { startsWith: 'image/' },
          ...(includePrivate ? {} : { isPrivate: false }),
          libraryMode: this.libraryMode,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, ownerId: true, mediaRevision: true, width: true, height: true },
      });
      if (!assets.length) break;
      scanned += assets.length;
      const existing = await this.prisma.eagleAssetProcessingJob.findMany({
        where: {
          ownerId,
          assetId: { in: assets.map(({ id }) => id) },
          libraryMode: this.libraryMode,
        },
        select: {
          id: true,
          assetId: true,
          assetRevision: true,
          kind: true,
          processorVersion: true,
          status: true,
        },
      });
      const facts = await readMediaProcessingFacts(
        this.prisma,
        ownerId,
        this.libraryMode,
        assets.map(({ id }) => id),
      );
      const factsByRevision = new Map(
        facts.map((fact) => [`${fact.assetId}:${fact.assetRevision}`, fact]),
      );
      const existingByAssetRevision = new Map<string, typeof existing>();
      for (const job of existing) {
        const key = `${job.assetId}:${job.assetRevision}`;
        const jobs = existingByAssetRevision.get(key) ?? [];
        jobs.push(job);
        existingByAssetRevision.set(key, jobs);
      }
      const repairIds: string[] = [];
      const missing = assets.flatMap((asset) => {
        const key = `${asset.id}:${asset.mediaRevision}`;
        const fact = factsByRevision.get(key);
        const outputs: Record<string, boolean> = {
          GENERATE_RENDITIONS: fact?.renditionsReady ?? false,
          EXTRACT_COLOR_PALETTE: fact?.paletteReady ?? false,
          GENERATE_IMAGE_PYRAMID: fact?.pyramidReady ?? false,
          GENERATE_EMBEDDING: fact?.embeddingReady ?? false,
        };
        const repairsBefore = repairIds.length;
        for (const job of existingByAssetRevision.get(key) ?? []) {
          const ready =
            job.processorVersion === PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION
              ? fact?.detailsReady
              : outputs[job.kind];
          if (job.status === 'COMPLETED' && ready === false) repairIds.push(job.id);
        }
        const jobs = buildMissingImageProcessingJobs(
          {
            ownerId,
            assetId: asset.id,
            assetRevision: asset.mediaRevision,
            width: asset.width,
            height: asset.height,
            ...fact,
          },
          existingByAssetRevision.get(`${asset.id}:${asset.mediaRevision}`) ?? [],
        );
        if (jobs.length || repairIds.length > repairsBefore) assetsMissingCount += 1;
        return jobs;
      });
      missingCount += missing.length + repairIds.length;
      const retryIds = repairIds.slice(0, Math.max(0, creationLimit - created));
      if (retryIds.length) {
        const repaired = await this.prisma.eagleAssetProcessingJob.updateMany({
          where: {
            id: { in: retryIds },
            ownerId,
            libraryMode: this.libraryMode,
            status: 'COMPLETED',
            asset: { deletedAt: null },
          },
          data: mediaRequeueData(),
        });
        created += repaired.count;
      }
      const creatable = missing.slice(0, Math.max(0, creationLimit - created));
      if (creatable.length) {
        const result = await this.prisma.eagleAssetProcessingJob.createMany({
          data: creatable.map((row) => inLibrary(this.libraryMode, row)),
          skipDuplicates: true,
        });
        created += result.count;
      }
      cursor = assets.at(-1)?.id;
      if (assets.length < pageSize) break;
    } while (cursor);
    return {
      scanned,
      created,
      skipped: scanned - assetsMissingCount,
      remaining: Math.max(0, missingCount - created),
    };
  }
  async updateSettings(ownerId: string, input: UpdateEagleProcessingSettingsDto) {
    const row = await this.prisma.eagleProcessingSetting.upsert({
      where: {
        ownerId_libraryMode: { ownerId, libraryMode: this.libraryMode },
        libraryMode: this.libraryMode,
      },
      create: { ownerId, ...input, libraryMode: this.libraryMode },
      update: input,
    });
    return {
      mode: row.mode,
      nightStart: row.nightStart,
      nightEnd: row.nightEnd,
      timeZone: 'Asia/Shanghai' as const,
    };
  }
  async getSettings(ownerId: string) {
    const row = await this.prisma.eagleProcessingSetting.findUnique({
      where: {
        ownerId_libraryMode: { ownerId, libraryMode: this.libraryMode },
        libraryMode: this.libraryMode,
      },
    });
    return {
      mode: row?.mode ?? 'NIGHT',
      nightStart: row?.nightStart ?? '23:00',
      nightEnd: row?.nightEnd ?? '06:00',
      timeZone: 'Asia/Shanghai' as const,
    };
  }
}

function groupCount(
  rows: Array<{ lane: string; status: string; _count: number }>,
  lane: string,
  status: string,
) {
  return rows.find((row) => row.lane === lane && row.status === status)?._count ?? 0;
}
