import { taskSection, type TaskGroup, type BackgroundSchedule, type TaskWaitReason, type TaskSection } from './task-scheduling';

/** Adapters provide facts. Rule order and reasons belong here, including SQL compilation. */
export const TASK_GATES = [
  ['approval', 'APPROVAL'], ['paused', 'PAUSED'], ['workerOffline', 'WORKER_OFFLINE'],
  ['disabled', 'DISABLED'], ['modelDrifted', 'MODEL_DRIFTED'], ['modelOffline', 'MODEL_OFFLINE'],
  ['dependencyFailed', 'DEPENDENCY_FAILED'], ['dependencyPending', 'DEPENDENCY'],
  ['outsideSchedule', 'SCHEDULE'], ['retryPending', 'RETRY'],
] as const satisfies ReadonlyArray<readonly [string, TaskWaitReason]>;
export type TaskGate = (typeof TASK_GATES)[number][0];
export type TaskGateFacts = Record<TaskGate, boolean>;
export interface TaskDecision { runnable: boolean; reason: TaskWaitReason; nextAt: string | null }
export function decideTask(facts: TaskGateFacts, nextAt: string | null = null): TaskDecision {
  const reason = TASK_GATES.find(([gate]) => facts[gate])?.[1] ?? 'QUEUED';
  return { runnable: reason === 'QUEUED', reason, nextAt: reason === 'RETRY' || reason === 'SCHEDULE' ? nextAt : null };
}

export type TaskDisplayStatus = 'RUNNING' | 'QUEUED' | 'STOPPED' | 'COMPLETED' | 'WAITING';
export interface TaskPresentation { status: TaskDisplayStatus; section: TaskSection; reason: TaskWaitReason | null }
/** Running work drains after pause; a partly blocked group must not hide its runnable siblings. */
export function taskGroupPresentation(group: TaskGroup, schedule: BackgroundSchedule): TaskPresentation {
  const section = taskSection(group, schedule);
  const blocked = group.waiting.filter((wait) => wait.reason !== 'QUEUED');
  const allBlocked = group.queued > 0 && blocked.reduce((sum, wait) => sum + wait.count, 0) >= group.queued;
  const reason = allBlocked ? blocked[0]?.reason ?? null : group.approval > 0 ? 'APPROVAL' : null;
  const status: TaskDisplayStatus = group.running > 0 ? 'RUNNING'
    : group.queued > 0 && section === 'PAUSED' ? 'STOPPED'
    : allBlocked || group.approval > 0 ? 'WAITING'
    : group.queued > 0 ? 'QUEUED'
    : group.failed > 0 ? 'STOPPED' : 'COMPLETED';
  return { status, section, reason };
}

export const MEDIA_LEASE_MS = 10 * 60 * 1000;
export const MEDIA_FAILURE_LIMIT = 12;
export interface MediaClaimState {
  status: string; availableAt: Date; lockedAt: Date | null; startedAt: Date | null;
  attempts: number; leaseVersion: number;
}
/** A candidate is a hint, never an execution grant. Database CAS must apply the returned guard. */
export function mediaClaimTransition(job: MediaClaimState, now: Date) {
  const staleBefore = new Date(now.getTime() - MEDIA_LEASE_MS);
  const recovery = job.status === 'PROCESSING' && job.lockedAt !== null && job.lockedAt < staleBefore;
  if (!(job.status === 'PENDING' && job.availableAt <= now) && !recovery) return null;
  return {
    recovery,
    where: { leaseVersion: job.leaseVersion, status: recovery ? 'PROCESSING' as const : 'PENDING' as const,
      ...(recovery ? { lockedAt: { lt: staleBefore } } : { availableAt: { lte: now } }) },
    data: { status: 'PROCESSING' as const, lockedAt: now, startedAt: now,
      attempts: { increment: 1 as const }, leaseVersion: { increment: 1 as const } },
  };
}
