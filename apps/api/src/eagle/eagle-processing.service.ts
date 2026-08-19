import { Injectable, NotFoundException } from '@nestjs/common';
import { EagleMediaJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListEagleProcessingJobsDto,
  UpdateEagleProcessingSettingsDto,
} from './eagle-processing.dto';
import { COLOR_PROCESSOR_VERSION } from './eagle-color-search';
import { buildMissingImageProcessingJobs } from './media-job-plan';

@Injectable()
export class EagleProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string, includePrivate = false) {
    const visibleAsset = includePrivate ? {} : { isPrivate: false };
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const onlineSince = new Date(Date.now() - 45_000);
    const [workers, running, queued, failed, completedLast24Hours, grouped, coverage, settings] =
      await Promise.all([
        this.prisma.eagleProcessingWorkerHeartbeat.findMany({
          where: { heartbeatAt: { gte: onlineSince } },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: { ownerId, status: 'PROCESSING', asset: visibleAsset },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: { ownerId, status: 'PENDING', asset: visibleAsset },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: { ownerId, status: 'FAILED', asset: visibleAsset },
        }),
        this.prisma.eagleAssetProcessingJob.count({
          where: {
            ownerId,
            status: 'COMPLETED',
            completedAt: { gte: since },
            asset: visibleAsset,
          },
        }),
        this.prisma.eagleAssetProcessingJob.groupBy({
          by: ['lane', 'status'],
          where: { ownerId, asset: visibleAsset },
          _count: true,
        }),
        this.prisma.eagleAssetColorAnalysis.groupBy({
          by: ['status'],
          where: { ownerId, isCurrent: true, asset: visibleAsset },
          _count: true,
        }),
        this.getSettings(ownerId),
      ]);
    const countColor = (status: string) =>
      coverage.find((row) => row.status === status)?._count ?? 0;
    const eligible = await this.prisma.eagleAsset.count({
      where: {
        ownerId,
        deletedAt: null,
        mimeType: { startsWith: 'image/' },
        ...visibleAsset,
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
        kind: query.kind,
        asset: includePrivate ? {} : { isPrivate: false },
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
        },
        select: { id: true, assetId: true, assetRevision: true, kind: true },
      });
      if (!job) return 0;
      const result = await transaction.eagleAssetProcessingJob.updateMany({
        where: { ownerId, id: job.id, status: 'FAILED' },
        data: retryJobData(),
      });
      if (result.count && job.kind !== 'EXTRACT_COLOR_PALETTE' && job.kind !== 'PURGE_ASSET') {
        await transaction.eagleAsset.updateMany({
          where: {
            ownerId,
            id: job.assetId,
            mediaRevision: job.assetRevision,
            deletedAt: null,
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
      const jobs = await transaction.eagleAssetProcessingJob.findMany({
        where: {
          ownerId,
          status: 'FAILED',
          asset: includePrivate ? {} : { isPrivate: false },
        },
        select: { id: true, assetId: true, assetRevision: true, kind: true },
      });
      if (!jobs.length) return 0;
      const result = await transaction.eagleAssetProcessingJob.updateMany({
        where: { ownerId, id: { in: jobs.map(({ id }) => id) }, status: 'FAILED' },
        data: retryJobData(),
      });
      for (const job of jobs) {
        if (job.kind === 'EXTRACT_COLOR_PALETTE' || job.kind === 'PURGE_ASSET') continue;
        await transaction.eagleAsset.updateMany({
          where: {
            ownerId,
            id: job.assetId,
            mediaRevision: job.assetRevision,
            deletedAt: null,
          },
          data: { lifecycleStatus: 'PROCESSING', mediaErrorCode: null },
        });
      }
      return result.count;
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
          mimeType: { not: 'video/mp4' },
          ...(includePrivate ? {} : { isPrivate: false }),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, ownerId: true, mediaRevision: true, width: true, height: true },
      });
      if (!assets.length) break;
      scanned += assets.length;
      const existing = await this.prisma.eagleAssetProcessingJob.findMany({
        where: { ownerId, assetId: { in: assets.map(({ id }) => id) } },
        select: {
          id: true,
          assetId: true,
          assetRevision: true,
          kind: true,
          processorVersion: true,
        },
      });
      const existingByAssetRevision = new Map<string, typeof existing>();
      for (const job of existing) {
        const key = `${job.assetId}:${job.assetRevision}`;
        const jobs = existingByAssetRevision.get(key) ?? [];
        jobs.push(job);
        existingByAssetRevision.set(key, jobs);
      }
      const missing = assets.flatMap((asset) => {
        const jobs = buildMissingImageProcessingJobs(
          {
            ownerId,
            assetId: asset.id,
            assetRevision: asset.mediaRevision,
            width: asset.width,
            height: asset.height,
          },
          existingByAssetRevision.get(`${asset.id}:${asset.mediaRevision}`) ?? [],
        );
        if (jobs.length) assetsMissingCount += 1;
        return jobs;
      });
      missingCount += missing.length;
      const creatable = missing.slice(0, Math.max(0, creationLimit - created));
      if (creatable.length) {
        const result = await this.prisma.eagleAssetProcessingJob.createMany({
          data: creatable,
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
      where: { ownerId },
      create: { ownerId, ...input },
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
    const row = await this.prisma.eagleProcessingSetting.findUnique({ where: { ownerId } });
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

function retryJobData() {
  return {
    status: EagleMediaJobStatus.PENDING,
    attempts: 0,
    availableAt: new Date(),
    lockedAt: null,
    startedAt: null,
    completedAt: null,
    lastError: null,
  };
}
