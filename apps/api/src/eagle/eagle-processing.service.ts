import { Injectable, NotFoundException } from '@nestjs/common';
import { EagleMediaJobKind, EagleMediaJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ListEagleProcessingJobsDto, UpdateEagleProcessingSettingsDto } from './eagle-processing.dto';

@Injectable()
export class EagleProcessingService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ownerId: string) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const onlineSince = new Date(Date.now() - 45_000);
    const [workers, running, queued, failed, completedLast24Hours, grouped, coverage, settings] = await Promise.all([
      this.prisma.eagleProcessingWorkerHeartbeat.findMany({ where: { heartbeatAt: { gte: onlineSince } } }),
      this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'PROCESSING' } }),
      this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'PENDING' } }),
      this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'FAILED' } }),
      this.prisma.eagleAssetProcessingJob.count({ where: { ownerId, status: 'COMPLETED', completedAt: { gte: since } } }),
      this.prisma.eagleAssetProcessingJob.groupBy({ by: ['lane', 'status'], where: { ownerId }, _count: true }),
      this.prisma.eagleAssetColorAnalysis.groupBy({ by: ['status'], where: { ownerId, isCurrent: true }, _count: true }),
      this.getSettings(ownerId),
    ]);
    const countColor = (status: string) => coverage.find((row) => row.status === status)?._count ?? 0;
    const eligible = await this.prisma.eagleAsset.count({ where: { ownerId, deletedAt: null, mimeType: { startsWith: 'image/' } } });
    const completed = countColor('COMPLETED');
    return {
      worker: { status: workers.length ? 'ONLINE' : 'OFFLINE', count: workers.length, activeJobCount: workers.reduce((sum, worker) => sum + worker.activeJobCount, 0), lastHeartbeatAt: workers[0]?.heartbeatAt ?? null, version: workers[0]?.version ?? null },
      counts: { running, queued, failed, completedLast24Hours },
      queues: ['INTERACTIVE', 'BACKGROUND', 'MAINTENANCE'].map((lane) => ({ lane, queued: groupCount(grouped, lane, 'PENDING'), running: groupCount(grouped, lane, 'PROCESSING'), failed: groupCount(grouped, lane, 'FAILED') })),
      colorCoverage: { processorVersion: 'color-v1', eligible, completed, processing: countColor('RUNNING') + countColor('PENDING'), failed: countColor('FAILED'), percentage: eligible ? Math.round(completed / eligible * 100) : 100 },
      settings,
      refreshedAt: new Date().toISOString(),
    };
  }

  async jobs(ownerId: string, query: ListEagleProcessingJobsDto) {
    const rows = await this.prisma.eagleAssetProcessingJob.findMany({
      where: { ownerId, status: query.status as EagleMediaJobStatus | undefined, lane: query.lane as never, kind: query.kind as EagleMediaJobKind | undefined },
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { asset: { select: { displayName: true } } },
    });
    return { items: rows.map(({ asset, ...job }) => ({ id: job.id, assetReference: asset.displayName, kind: job.kind, lane: job.lane, status: job.status, processorVersion: job.processorVersion, attempts: job.attempts, availableAt: job.availableAt, startedAt: job.startedAt, completedAt: job.completedAt, durationMs: job.startedAt && job.completedAt ? job.completedAt.getTime() - job.startedAt.getTime() : null, lastError: job.lastError, createdAt: job.createdAt, updatedAt: job.updatedAt })), nextCursor: null };
  }

  async retry(ownerId: string, jobId: string) {
    const result = await this.prisma.eagleAssetProcessingJob.updateMany({ where: { ownerId, id: jobId, status: 'FAILED' }, data: { status: 'PENDING', availableAt: new Date(), lastError: null, lockedAt: null } });
    if (!result.count) throw new NotFoundException('没有可重试的处理任务。');
    return { retried: result.count };
  }
  async retryFailed(ownerId: string) {
    const result = await this.prisma.eagleAssetProcessingJob.updateMany({ where: { ownerId, status: 'FAILED' }, data: { status: 'PENDING', availableAt: new Date(), lastError: null, lockedAt: null } });
    return { retried: result.count };
  }
  async reconcile(ownerId: string) {
    const assets = await this.prisma.eagleAsset.findMany({ where: { ownerId, deletedAt: null, lifecycleStatus: { in: ['PROCESSING', 'FAILED'] } }, select: { id: true, mediaRevision: true, _count: { select: { processingJobs: true } } } });
    const missing = assets.filter((asset) => asset._count.processingJobs === 0);
    if (missing.length) await this.prisma.eagleAssetProcessingJob.createMany({ data: missing.map((asset) => ({ ownerId, assetId: asset.id, kind: 'GENERATE_RENDITIONS', assetRevision: asset.mediaRevision })) });
    return { scanned: assets.length, created: missing.length, skipped: assets.length - missing.length, remaining: 0 };
  }
  async updateSettings(ownerId: string, input: UpdateEagleProcessingSettingsDto) {
    const row = await this.prisma.eagleProcessingSetting.upsert({ where: { ownerId }, create: { ownerId, ...input }, update: input });
    return { mode: row.mode, nightStart: row.nightStart, nightEnd: row.nightEnd, timeZone: 'Asia/Shanghai' as const };
  }
  async getSettings(ownerId: string) {
    const row = await this.prisma.eagleProcessingSetting.findUnique({ where: { ownerId } });
    return { mode: row?.mode ?? 'NIGHT', nightStart: row?.nightStart ?? '23:00', nightEnd: row?.nightEnd ?? '06:00', timeZone: 'Asia/Shanghai' as const };
  }
}

function groupCount(rows: Array<{ lane: string; status: string; _count: number }>, lane: string, status: string) { return rows.find((row) => row.lane === lane && row.status === status)?._count ?? 0; }
