const RUNNABLE = new Set(['PENDING', 'RETRY']);
const CONNECTIVITY_FAILURE_STAGES = new Set(['SERVER_CONNECT', 'UPLOAD', 'COMMIT']);

export function selectRunnableJobs(jobs, now, limit) {
  return jobs
    .filter(
      (job) => RUNNABLE.has(job.status) && (job.nextAttemptAt === null || job.nextAttemptAt <= now),
    )
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function decideFailure(error, attempts, now, random = Math.random) {
  if (error?.kind === 'AUTH') return { status: 'PAUSED_AUTH', nextAttemptAt: null };
  if (error?.kind === 'CONFIG') return { status: 'WAITING_CONFIG', nextAttemptAt: null };
  if (error?.kind === 'PERMANENT') return { status: 'FAILED', nextAttemptAt: null };
  const exponential = Math.min(10 * 60_000, 1_000 * 2 ** Math.min(9, Math.max(0, attempts - 1)));
  return {
    status: 'RETRY',
    nextAttemptAt: now + Math.round(exponential * (1 + random() * 0.25)),
  };
}

export function selectConnectivityRetryJobIds(jobs, successfulJobId) {
  return jobs
    .filter(
      (job) =>
        job.id !== successfulJobId &&
        job.status === 'RETRY' &&
        (CONNECTIVITY_FAILURE_STAGES.has(job.lastFailureStage) ||
          (!job.lastFailureStage && job.blob instanceof Blob)),
    )
    .map(({ id }) => id);
}

export function selectCompletedJobIdsToPrune(
  jobs,
  now,
  { maxEntries = 500, maxAgeMs = 30 * 24 * 60 * 60_000 } = {},
) {
  const oldestAllowed = now - maxAgeMs;
  return jobs
    .filter((job) => job.status === 'COMPLETED')
    .sort(
      (left, right) =>
        (right.completedAt || right.updatedAt || 0) - (left.completedAt || left.updatedAt || 0),
    )
    .filter(
      (job, index) =>
        index >= maxEntries || (job.completedAt || job.updatedAt || 0) < oldestAllowed,
    )
    .map(({ id }) => id);
}
