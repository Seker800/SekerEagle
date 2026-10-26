import {
  taskSection,
  type TaskGroup,
  type BackgroundSchedule,
  type TaskWaitReason,
  type TaskSection,
  isBackgroundFamily,
  backgroundScheduleAllows,
  nextBackgroundTime,
  type TaskFamily,
  type WorkerTaskCapabilities,
} from './task-scheduling';

/** Adapters provide facts. Rule order and reasons belong here, including SQL compilation. */
export const TASK_GATES = [
  ['approval', 'APPROVAL'],
  ['paused', 'PAUSED'],
  ['workerOffline', 'WORKER_OFFLINE'],
  ['disabled', 'DISABLED'],
  ['modelDrifted', 'MODEL_DRIFTED'],
  ['modelOffline', 'MODEL_OFFLINE'],
  ['dependencyFailed', 'DEPENDENCY_FAILED'],
  ['dependencyPending', 'DEPENDENCY'],
  ['outsideSchedule', 'SCHEDULE'],
  ['retryPending', 'RETRY'],
] as const satisfies ReadonlyArray<readonly [string, TaskWaitReason]>;
export type TaskGate = (typeof TASK_GATES)[number][0];
export type TaskGateFacts = Record<TaskGate, boolean>;
export interface TaskDecision {
  runnable: boolean;
  reason: TaskWaitReason;
  nextAt: string | null;
}
export function decideTask(facts: TaskGateFacts, nextAt: string | null = null): TaskDecision {
  const reason = TASK_GATES.find(([gate]) => facts[gate])?.[1] ?? 'QUEUED';
  return {
    runnable: reason === 'QUEUED',
    reason,
    nextAt: reason === 'RETRY' || reason === 'SCHEDULE' ? nextAt : null,
  };
}

export type TaskDisplayStatus = 'RUNNING' | 'QUEUED' | 'STOPPED' | 'COMPLETED' | 'WAITING';
export interface TaskPresentation {
  status: TaskDisplayStatus;
  section: TaskSection;
  reason: TaskWaitReason | null;
}
/** Running work drains after pause; a partly blocked group must not hide its runnable siblings. */
export function taskGroupPresentation(
  group: TaskGroup,
  schedule: BackgroundSchedule,
  embedding?: string,
): TaskPresentation {
  const section = taskSection(group, schedule);
  const blocked = group.waiting.filter((wait) => wait.reason !== 'QUEUED' && wait.count > 0);
  const allBlocked =
    group.queued > 0 && blocked.reduce((sum, wait) => sum + wait.count, 0) >= group.queued;
  const reason = allBlocked
    ? (TASK_GATES.find(([, reason]) => blocked.some((wait) => wait.reason === reason))?.[1] ?? null)
    : group.approval > 0
      ? 'APPROVAL'
      : null;
  if (
    group.id === 'EMBEDDING' &&
    group.running + group.queued > 0 &&
    (embedding === 'OFFLINE' || embedding === 'DRIFTED')
  )
    return {
      section,
      status: 'WAITING',
      reason: embedding === 'DRIFTED' ? 'MODEL_DRIFTED' : 'MODEL_OFFLINE',
    };
  const status: TaskDisplayStatus =
    group.running > 0
      ? 'RUNNING'
      : group.queued > 0 && section === 'PAUSED'
        ? 'STOPPED'
        : allBlocked || group.approval > 0
          ? 'WAITING'
          : group.queued > 0
            ? 'QUEUED'
            : group.failed > 0
              ? 'STOPPED'
              : 'COMPLETED';
  return { status, section, reason };
}

export const MEDIA_LEASE_MS = 10 * 60 * 1000;
export const MEDIA_FAILURE_LIMIT = 12;
export const MEDIA_RECOVERY_LIMIT = 3;
export class MediaLeaseRecoveryExhaustedError extends Error {
  constructor() {
    super('MEDIA_LEASE_RECOVERY_EXHAUSTED');
  }
}
export interface MediaClaimState {
  status: string;
  availableAt: Date;
  lockedAt: Date | null;
  startedAt: Date | null;
  attempts: number;
  leaseVersion: number;
  recoveryCount: number;
}
/** A candidate is a hint, never an execution grant. Database CAS must apply the returned guard. */
export function mediaClaimTransition(job: MediaClaimState, now: Date) {
  const staleBefore = new Date(now.getTime() - MEDIA_LEASE_MS);
  const recovery =
    job.status === 'PROCESSING' && job.lockedAt !== null && job.lockedAt < staleBefore;
  if (!(job.status === 'PENDING' && job.availableAt <= now) && !recovery) return null;
  return {
    recovery,
    exhausted: recovery && job.recoveryCount >= MEDIA_RECOVERY_LIMIT,
    where: {
      leaseVersion: job.leaseVersion,
      status: recovery ? ('PROCESSING' as const) : ('PENDING' as const),
      ...(recovery ? { lockedAt: { lt: staleBefore } } : { availableAt: { lte: now } }),
    },
    data: {
      status: 'PROCESSING' as const,
      lockedAt: now,
      startedAt: now,
      attempts: { increment: 1 as const },
      leaseVersion: { increment: 1 as const },
      recoveryCount: { increment: recovery ? 1 : 0 },
    },
  };
}

/** Unknown capabilities during a rolling upgrade are not evidence that work is disabled. */
export function workerSupportsTask(value: unknown, family: TaskFamily, step: string): boolean {
  if (!value || typeof value !== 'object' || !('background' in value)) return true;
  const capability = value as WorkerTaskCapabilities;
  if (isBackgroundFamily(family) && !capability.background) return false;
  if (family === 'VIDEO' && !capability.video) return false;
  if (family === 'SMART_FOLDERS') return capability.smartFolders;
  if (family === 'TAG_INDEX') return capability.tagBuilds;
  if (family === 'PHOTO_MAP') return capability.photoMap;
  return !capability.jobKinds || capability.jobKinds.includes(step) || step === 'OBJECT_DELETION';
}
export function taskModelReadiness(workers: readonly unknown[], family: TaskFamily, step: string) {
  const states = workers
    .filter((worker) => workerSupportsTask(worker, family, step))
    .map((worker) => (worker as WorkerTaskCapabilities | null)?.embedding);
  if (states.includes('READY')) return 'READY';
  // A worker without a model report may still serve work during a rolling upgrade.
  if (states.some((state) => state === undefined)) return 'UNKNOWN';
  return states.includes('DRIFTED')
    ? 'DRIFTED'
    : states.includes('OFFLINE')
      ? 'OFFLINE'
      : 'UNKNOWN';
}
export function taskBucketDecision(input: {
  family: TaskFamily;
  step: string;
  reason: TaskWaitReason;
  nextAt: string | null;
  approval: boolean;
  paused: boolean;
  workers: readonly unknown[];
  schedule: BackgroundSchedule;
  now: Date;
}): TaskDecision {
  const { family, step, workers, schedule, now } = input;
  const background = isBackgroundFamily(family);
  const workerOwned = !['UPLOADS', 'IMPORTS', 'APPROVALS'].includes(family);
  const model = taskModelReadiness(workers, family, step);
  const needsModel =
    family === 'EMBEDDING' || (family === 'SMART_FOLDERS' && step === 'SMART_FOLDER_QUERY');
  const outsideSchedule = background && !backgroundScheduleAllows(schedule, now);
  return decideTask(
    {
      approval: input.approval,
      paused: input.paused || (background && schedule.mode === 'MANUAL'),
      workerOffline: workerOwned && workers.length === 0,
      disabled: workerOwned && !workers.some((worker) => workerSupportsTask(worker, family, step)),
      modelDrifted: needsModel && model === 'DRIFTED',
      modelOffline: needsModel && model === 'OFFLINE',
      dependencyFailed: input.reason === 'DEPENDENCY_FAILED',
      dependencyPending: input.reason === 'DEPENDENCY',
      outsideSchedule,
      retryPending: input.reason === 'RETRY',
    },
    outsideSchedule ? (nextBackgroundTime(schedule, now)?.toISOString() ?? null) : input.nextAt,
  );
}

export interface TaskTransitionEvent {
  id: string;
  jobId: string;
  step: string;
  fromStatus: string | null;
  toStatus: string;
  leaseVersion: number;
  attempts: number;
  recoveryCount: number;
  occurredAt: string;
}

interface MediaExecution {
  id: string;
  ownerId: string;
  libraryMode: 'MATERIAL' | 'PHOTO';
  assetId: string;
  assetRevision: number;
  leaseVersion: number;
}
export function mediaExecutionGuard(job: MediaExecution) {
  return {
    id: job.id,
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    assetId: job.assetId,
    assetRevision: job.assetRevision,
    status: 'PROCESSING' as const,
    leaseVersion: job.leaseVersion,
  };
}
export function mediaCompletion(job: MediaExecution, now = new Date()) {
  return {
    where: mediaExecutionGuard(job),
    data: { status: 'COMPLETED' as const, completedAt: now, lockedAt: null, lastError: null },
  };
}
/** Adapters classify permanent media errors. The core owns budget, backoff and guarded state changes. */
export function mediaFailure(
  job: MediaExecution & { attempts: number; kind: string },
  error: string,
  permanent: boolean,
  now = new Date(),
) {
  const terminal =
    permanent || job.attempts >= (job.kind === 'RENDER_EDITED_COPY' ? 3 : MEDIA_FAILURE_LIMIT);
  const data = terminal
    ? {
        status: 'FAILED' as const,
        completedAt: now,
        lockedAt: null,
        lastError: error.slice(0, 1000),
      }
    : {
        status: 'PENDING' as const,
        availableAt: new Date(
          now.getTime() + Math.min(3600, 2 ** Math.min(job.attempts, MEDIA_FAILURE_LIMIT)) * 1000,
        ),
        lockedAt: null,
        lastError: error.slice(0, 1000),
      };
  return { terminal, where: mediaExecutionGuard(job), data };
}
/** External service backpressure or outage is a wait, not a bad-image failure. */
export function mediaWaitData(attempts: number, delayMs: number, code: string, now = new Date()) {
  return {
    status: 'PENDING' as const,
    attempts: Math.max(0, attempts - 1),
    availableAt: new Date(now.getTime() + delayMs),
    lockedAt: null,
    lastError: code,
  };
}
