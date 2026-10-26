import {
  taskSection,
  type TaskGroup,
  type BackgroundSchedule,
  type TaskWaitReason,
  type TaskPresentation,
  type TaskCenterOverview,
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

/** Running work drains after pause; a partly blocked group must not hide its runnable siblings. */
export function taskGroupPresentation(
  group: TaskGroup,
  schedule: BackgroundSchedule,
  embedding?: TaskCenterOverview['embedding'],
  worker?: 'ONLINE' | 'OFFLINE',
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
    worker === 'OFFLINE' &&
    taskWorkerOwned(group.id) &&
    group.running + group.queued > 0 &&
    (group.running > 0 || section !== 'PAUSED')
  )
    return { section, status: 'WAITING', reason: 'WORKER_OFFLINE' };
  const activeSteps = group.steps.filter((step) => group.running > 0 ? step.running > 0 : step.queued > 0);
  const needsModel = group.id === 'EMBEDDING' || (activeSteps.length > 0 && activeSteps.every((step) => taskNeedsModel(group.id, step.id)));
  if (
    needsModel &&
    (group.running > 0 || section !== 'PAUSED') &&
    group.running + group.queued > 0 &&
    (embedding === 'OFFLINE' || embedding === 'DRIFTED')
  )
    return {
      section,
      status: 'WAITING',
      reason: embedding === 'DRIFTED' ? 'MODEL_DRIFTED' : 'MODEL_OFFLINE',
    };
  if (group.running > 0) return {status: 'RUNNING', section, reason};
  if (group.queued > 0 && section === 'PAUSED') return {status: 'STOPPED', section, reason};
  if (allBlocked || group.approval > 0) return {status: 'WAITING', section, reason};
  if (group.queued > 0) return {status: 'QUEUED', section, reason};
  return {status: group.failed > 0 ? 'STOPPED' : 'COMPLETED', section, reason};
}

/** Compatibility boundary: consumers honor server presentation; computation itself never reads it. */
export function resolveTaskPresentation(
  group: TaskGroup, schedule: BackgroundSchedule, embedding?: TaskCenterOverview['embedding'],
): TaskPresentation {
  return group.presentation ?? taskGroupPresentation(group, schedule, embedding);
}

export function taskNeedsModel(family: TaskFamily, step: string): boolean {
  return family === 'EMBEDDING' || (family === 'SMART_FOLDERS' && step === 'SMART_FOLDER_QUERY');
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
  const workerOwned = taskWorkerOwned(family);
  const model = taskModelReadiness(workers, family, step);
  const needsModel = taskNeedsModel(family, step);
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

export function taskWorkerOwned(family: TaskFamily) {
  return !['UPLOADS', 'IMPORTS', 'APPROVALS'].includes(family);
}

