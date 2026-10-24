import { Inject, Injectable, Optional } from '@nestjs/common';
import { type LibraryMode } from '@prisma/client';
import {
  DEFAULT_BACKGROUND_SCHEDULE, TASK_FAMILIES, backgroundScheduleAllows, isBackgroundFamily, mediaTaskFamily, nextBackgroundTime,
  type TaskCounts, type TaskCenterOverview, type TaskFamily, type TaskGroup, type TaskWaitReason, type WorkerTaskCapabilities,
} from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import { LIBRARY_MODE } from './library-mode';
import { taskCenterQuery } from './task-center-query';

interface TaskBucket {
  family: TaskFamily | 'MEDIA'; step: string; version: string; status: string;
  reason: TaskWaitReason; count: bigint; nextAt: Date | null;
}
const counts = () => ({ queued: 0, running: 0, failed: 0, completed: 0, approval: 0 });

@Injectable()
export class EagleTaskCenterService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
  ) {}

  async overview(ownerId: string, includePrivate = false): Promise<TaskCenterOverview> {
    const now = new Date();
    const [buckets, workers, setting] = await Promise.all([
      this.prisma.$queryRaw<TaskBucket[]>(taskCenterQuery(ownerId, this.libraryMode, includePrivate)),
      this.prisma.eagleProcessingWorkerHeartbeat.findMany({
        where: { heartbeatAt: { gte: new Date(now.getTime() - 45000), lte: now } }, select: { capabilities: true },
      }),
      this.prisma.eagleProcessingSetting.findUnique({ where: { ownerId_libraryMode: { ownerId, libraryMode: this.libraryMode } } }),
    ]);
    const settings = { mode: setting?.mode ?? DEFAULT_BACKGROUND_SCHEDULE.mode, nightStart: setting?.nightStart ?? '23:00', nightEnd: setting?.nightEnd ?? '06:00', timeZone: 'Asia/Shanghai' as const };
    const groups = new Map<TaskFamily, TaskGroup>();
    for (const bucket of buckets) {
      const family = bucket.family === 'MEDIA' ? mediaTaskFamily(bucket.step, bucket.version) : bucket.family;
      if (!TASK_FAMILIES.includes(family)) continue;
      let group = groups.get(family);
      if (!group) {
        group = { id: family, background: isBackgroundFamily(family), ...counts(), waiting: [], steps: [] };
        groups.set(family, group);
      }
      let step = group.steps.find((entry) => entry.id === bucket.step);
      if (!step) { step = { id: bucket.step, ...counts() }; group.steps.push(step); }
      const fields: Record<string, keyof TaskCounts> = { QUEUED: 'queued', RUNNING: 'running', FAILED: 'failed', COMPLETED: 'completed', APPROVAL: 'approval' };
      const field = fields[bucket.status];
      if (!field) continue;
      const count = Number(bucket.count);
      group[field] += count; step[field] += count;
      if (field !== 'queued' && field !== 'approval') continue;
      let reason = bucket.reason, nextAt = reason === 'RETRY' ? bucket.nextAt?.toISOString() ?? null : null;
      const workerOwned = !['UPLOADS', 'IMPORTS', 'APPROVALS'].includes(family);
      const capable = workers.some((worker) => supports(worker.capabilities, family, bucket.step));
      if (field === 'approval') reason = 'APPROVAL';
      else if (workerOwned && !workers.length) reason = 'WORKER_OFFLINE';
      else if (workerOwned && !capable) reason = 'DISABLED';
      else if (group.background && settings.mode === 'MANUAL') reason = 'PAUSED';
      else if (['DEPENDENCY', 'DEPENDENCY_FAILED'].includes(reason)) { /* Keep dependency explanation. */ }
      else if (group.background && !backgroundScheduleAllows(settings, now)) {
        reason = 'SCHEDULE'; nextAt = nextBackgroundTime(settings, now)?.toISOString() ?? null;
      } else if (family === 'AI_TAGS' && !setting?.aiTagManualEnabled) {
        if (!setting?.aiTagScheduleEnabled) reason = 'PAUSED';
        else {
          const aiSchedule = { mode: 'NIGHT', nightStart: setting.aiTagScheduleStart, nightEnd: setting.aiTagScheduleEnd };
          if (!backgroundScheduleAllows(aiSchedule, now)) { reason = 'SCHEDULE'; nextAt = nextBackgroundTime(aiSchedule, now)?.toISOString() ?? null; }
        }
      }
      if (reason !== 'RETRY' && reason !== 'SCHEDULE') nextAt = null;
      const wait = group.waiting.find((entry) => entry.reason === reason && entry.nextAt === nextAt);
      if (wait) wait.count += count; else group.waiting.push({ reason, count, nextAt });
    }
    return { worker: workers.length ? 'ONLINE' : 'OFFLINE', settings, groups: TASK_FAMILIES.flatMap((id) => groups.get(id) ?? []), refreshedAt: now.toISOString() };
  }
}

function supports(value: unknown, family: TaskFamily, step: string) {
  // Mixed-version fleets have unknown capabilities, never falsely claim an old worker is disabled.
  if (!value || typeof value !== 'object' || !('background' in value)) return true;
  const capability = value as WorkerTaskCapabilities;
  if (isBackgroundFamily(family) && !capability.background) return false;
  if (family === 'VIDEO' && !capability.video) return false;
  if (family === 'SMART_FOLDERS') return capability.smartFolders;
  if (family === 'TAG_INDEX') return capability.tagBuilds;
  if (family === 'PHOTO_MAP') return capability.photoMap;
  return !capability.jobKinds || capability.jobKinds.includes(step) || step === 'OBJECT_DELETION';
}
