import { Injectable, NotFoundException } from '@nestjs/common';
import { EagleMediaJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ListEagleProcessingJobsDto,
  UpdateEagleProcessingSettingsDto,
} from './eagle-processing.dto';
import { COLOR_PROCESSOR_VERSION } from './eagle-color-search';

@Injectable()
export class EagleProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const onlineSince = new Date(Date.now() - 45_000);
    const [workers, running, queued, failed, completedLast24Hours, grouped, coverage, settings] =
      await Promise.all([
        this.prisma.eagleProcessingWorkerHeartbeat.findMany({
          where: { heartbeatAt: { gte: onlineSince } },
        }),
        this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'PROCESSING' } }),
        this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'PENDING' } }),
        this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'FAILED' } }),
        this.prisma.eagleAssetProcessingJob.count({
          where: { ownerId, status: 'COMPLETED', completedAt: { gte: since } },
        }),
        this.prisma.eagleAssetProcessingJob.groupBy({
          by: ['lane', 'status'],
          where: { ownerId },
          _count: true,
        }),
        this.prisma.eagleAssetColorAnalysis.groupBy({
          by: ['status'],
          where: { ownerId, isCurrent: true },
          _count: true,
        }),
        this.getSettings(ownerId),
      ]);
    const countColor = (status: string) =>
      coverage.find((row) => row.status === status)?._count ?? 0;
    const eligible = await this.prisma.eagleAsset.count({
      where: { ownerId, deletedAt: null, mimeType: { startsWith: 'image/' } },
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

  async jobs(ownerId: string, query: ListEagleProcessingJobsDto) {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.eagleAssetProcessingJob.findMany({
      where: { ownerId, status: query.status, lane: query.lane, kind: query.kind },
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

  async retry(ownerId: string, jobId: string) {
    const retried = await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.eagleAssetProcessingJob.findFirst({
        where: { ownerId, id: jobId, status: 'FAILED' },
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
  async retryFailed(ownerId: string) {
    const retried = await this.prisma.$transaction(async (transaction) => {
      const jobs = await transaction.eagleAssetProcessingJob.findMany({
        where: { ownerId, status: 'FAILED' },
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
  async reconcile(ownerId: string) {
    const pageSize = 500;
    const creationLimit = 500;
    let cursor: string | undefined;
    let scanned = 0;
    let created = 0;
    let missingCount = 0;
    do {
      const assets = await this.prisma.eagleAsset.findMany({
        where: { ownerId, deletedAt: null, mimeType: { not: 'video/mp4' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, ownerId: true, mediaRevision: true },
      });
      if (!assets.length) break;
      scanned += assets.length;
      const existing = await this.prisma.eagleAssetProcessingJob.findMany({
        where: { ownerId, assetId: { in: assets.map(({ id }) => id) } },
        select: { assetId: true, assetRevision: true, kind: true, processorVersion: true },
      });
      const keys = new Set(
        existing.map(
          (job) => `${job.assetId}:${job.assetRevision}:${job.kind}:${job.processorVersion}`,
        ),
      );
      const missing = assets
        .filter(
          (asset) =>
            !keys.has(
              `${asset.id}:${asset.mediaRevision}:EXTRACT_COLOR_PALETTE:${COLOR_PROCESSOR_VERSION}`,
            ),
        )
        .map((asset) => ({
          ownerId,
          assetId: asset.id,
          assetRevision: asset.mediaRevision,
          kind: 'EXTRACT_COLOR_PALETTE' as const,
          lane: 'BACKGROUND' as const,
          processorVersion: COLOR_PROCESSOR_VERSION,
        }));
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
      skipped: scanned - created,
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
