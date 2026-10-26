import { Inject, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { Prisma, EagleMediaJobKind, type LibraryMode } from '@prisma/client';
import { mediaTaskFamilySql, lockOwnerPrivacyProjection } from '@sekereagle/library-persistence';
import {
  DEFAULT_BACKGROUND_SCHEDULE,
  TASK_FAMILIES,
  taskBucketDecision,
  taskGroupPresentation,
  taskModelReadiness,
  workerSupportsTask,
  isBackgroundFamily,
  mediaTaskFamily,
  type TaskCounts,
  type TaskCenterOverview,
  type TaskFamily,
  type TaskGroup,
  type TaskWaitReason,
} from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import { LIBRARY_MODE } from './library-mode';
import { taskCenterQuery } from './task-center-query';

interface TaskBucket {
  family: TaskFamily | 'MEDIA';
  step: string;
  version: string;
  status: string;
  reason: TaskWaitReason;
  count: bigint;
  nextAt: Date | null;
}
const counts = () => ({ queued: 0, running: 0, failed: 0, completed: 0, approval: 0 });

@Injectable()
export class EagleTaskCenterService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async policy(ownerId: string, input: { family: TaskFamily; paused: boolean; priority?: number }) {
    const { family, paused } = input;
    const priority = 0; // Historical priority is no longer a user scheduling control.
    return this.prisma.eagleTaskPolicy.upsert({
      where: { ownerId_libraryMode_family: { ownerId, libraryMode: this.libraryMode, family } },
      create: { ownerId, libraryMode: this.libraryMode, family, paused, priority },
      update: { paused, priority },
      select: { family: true, paused: true, priority: true },
    });
  }

  async retry(ownerId: string, family: TaskFamily, includePrivate = false) {
    const retried = await this.prisma.$transaction(async (tx) => {
      await lockOwnerPrivacyProjection(tx, ownerId, this.libraryMode);
      if (family === 'SMART_FOLDERS') {
        return (
          await tx.eagleSmartFolderSemanticSnapshot.updateMany({
            where: { ownerId, libraryMode: this.libraryMode, status: 'FAILED' },
            data: {
              status: 'PENDING',
              attempts: 0,
              availableAt: new Date(),
              leaseToken: null,
              lockedUntil: null,
              errorCode: null,
            },
          })
        ).count;
      }
      if (family === 'TAG_INDEX') {
        return (
          await tx.eagleTagSemanticBuild.updateMany({
            where: {
              ownerId,
              libraryMode: this.libraryMode,
              status: 'FAILED',
              tag: includePrivate ? {} : { marksAssetsPrivate: false },
            },
            data: {
              status: 'PENDING',
              attempts: 0,
              availableAt: new Date(),
              lockedAt: null,
              completedAt: null,
              lastError: null,
              leaseVersion: { increment: 1 },
            },
          })
        ).count;
      }
      if (['CLEANUP', 'APPROVALS', 'UPLOADS', 'IMPORTS', 'PHOTO_MAP'].includes(family)) return 0;
      const kinds = Object.values(EagleMediaJobKind).filter(
        (kind) => kind !== 'GENERATE_AI_TAGS' && mediaTaskFamily(kind, 'v1') === family,
      );
      const condition =
        family === 'DETAILS'
          ? Prisma.sql`j."processorVersion"='photo-source-details-v1'`
          : family === 'VIDEO'
            ? Prisma.sql`${mediaTaskFamilySql(Prisma.sql`j.kind`, Prisma.sql`j."processorVersion"`)}='VIDEO'`
            : Prisma.sql`j.kind::text IN (${Prisma.join(kinds)}) AND j."processorVersion"<>'photo-source-details-v1' AND ${mediaTaskFamilySql(Prisma.sql`j.kind`, Prisma.sql`j."processorVersion"`)}<>'VIDEO'`;
      const rows = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        WITH retried AS (UPDATE "EagleMediaJob" j SET status='PENDING',attempts=0,"recoveryCount"=0,"availableAt"=now(),"lockedAt"=NULL,"startedAt"=NULL,"completedAt"=NULL,"lastError"=NULL,"leaseVersion"="leaseVersion"+1,"updatedAt"=now()
          FROM "EagleAsset" a WHERE j."ownerId"=${ownerId} AND j."libraryMode"=${this.libraryMode}::"LibraryMode" AND j.status='FAILED'
            AND a.id=j."assetId" AND a."ownerId"=j."ownerId" AND a."libraryMode"=j."libraryMode" AND a."mediaRevision"=j."assetRevision"
            AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate") AND ${condition} RETURNING j."assetId",j."assetRevision"
        ), restored AS (UPDATE "EagleAsset" a SET "lifecycleStatus"='PROCESSING',"mediaErrorCode"=NULL,"updatedAt"=now()
          FROM retried r WHERE ${family === 'BROWSE'} AND a.id=r."assetId" AND a."mediaRevision"=r."assetRevision"
          RETURNING a.id)
        SELECT count(*) AS count FROM retried
      `);
      return Number(rows[0]?.count ?? 0);
    });
    if (!retried) throw new NotFoundException('没有可重试的任务。');
    return { retried };
  }

  async overview(ownerId: string, includePrivate = false): Promise<TaskCenterOverview> {
    const now = new Date();
    const [buckets, workers, setting, policies] = await Promise.all([
      this.prisma.$queryRaw<TaskBucket[]>(
        taskCenterQuery(ownerId, this.libraryMode, includePrivate),
      ),
      this.prisma.eagleProcessingWorkerHeartbeat.findMany({
        where: { heartbeatAt: { gte: new Date(now.getTime() - 45000), lte: now } },
        select: { capabilities: true },
      }),
      this.prisma.eagleProcessingSetting.findUnique({
        where: { ownerId_libraryMode: { ownerId, libraryMode: this.libraryMode } },
      }),
      this.prisma.eagleTaskPolicy.findMany({
        where: { ownerId, libraryMode: this.libraryMode },
        select: { family: true, paused: true, priority: true },
      }),
    ]);
    const settings = {
      mode: setting?.mode ?? DEFAULT_BACKGROUND_SCHEDULE.mode,
      nightStart: setting?.nightStart ?? '23:00',
      nightEnd: setting?.nightEnd ?? '06:00',
      timeZone: 'Asia/Shanghai' as const,
    };
    const groups = new Map<TaskFamily, TaskGroup>();
    for (const bucket of buckets) {
      if (bucket.step === 'GENERATE_AI_TAGS') continue;
      const family =
        bucket.family === 'MEDIA' ? mediaTaskFamily(bucket.step, bucket.version) : bucket.family;
      if (!TASK_FAMILIES.includes(family)) continue;
      let group = groups.get(family);
      if (!group) {
        const policy = policies.find((entry) => entry.family === family);
        group = {
          id: family,
          background: isBackgroundFamily(family),
          policy: { paused: policy?.paused ?? false, priority: 0 },
          ...counts(),
          waiting: [],
          steps: [],
        };
        groups.set(family, group);
      }
      let step = group.steps.find((entry) => entry.id === bucket.step);
      if (!step) {
        step = { id: bucket.step, ...counts() };
        group.steps.push(step);
      }
      const fields: Record<string, keyof TaskCounts> = {
        QUEUED: 'queued',
        RUNNING: 'running',
        FAILED: 'failed',
        COMPLETED: 'completed',
        APPROVAL: 'approval',
      };
      const field = fields[bucket.status];
      if (!field) continue;
      const count = Number(bucket.count);
      group[field] += count;
      step[field] += count;
      if (field !== 'queued' && field !== 'approval') continue;
      const {reason, nextAt} = taskBucketDecision({
        family, step: bucket.step, reason: bucket.reason,
        nextAt: bucket.nextAt?.toISOString() ?? null,
        approval: field === 'approval', paused: group.policy?.paused ?? false,
        workers: workers.map((worker) => worker.capabilities), schedule: settings, now,
      });
      const wait = group.waiting.find(
        (entry) => entry.reason === reason && entry.nextAt === nextAt,
      );
      if (wait) wait.count += count;
      else group.waiting.push({ reason, count, nextAt });
    }
    for (const group of groups.values()) {
      const workerOwned = !['UPLOADS', 'IMPORTS', 'APPROVALS'].includes(group.id);
      group.availability = !workerOwned
        ? 'ENABLED'
        : !workers.length
          ? 'UNKNOWN'
          : group.steps.some((step) =>
                workers.some((worker) => workerSupportsTask(worker.capabilities, group.id, step.id)),
              )
            ? 'ENABLED'
            : 'DISABLED';
    }
    const embedding = taskModelReadiness(workers.map((worker) => worker.capabilities), 'EMBEDDING', 'GENERATE_EMBEDDING');
    for (const group of groups.values()) group.presentation = taskGroupPresentation(group, settings, embedding);
    return {
      worker: workers.length ? 'ONLINE' : 'OFFLINE',
      embedding,
      settings,
      groups: TASK_FAMILIES.flatMap((id) => groups.get(id) ?? []),
      refreshedAt: now.toISOString(),
    };
  }
}
