/** Media execution commands and lease guards; independent of dashboard presentation. */
export const MEDIA_LEASE_MS = 10 * 60 * 1000;
export const MEDIA_FAILURE_LIMIT = 12;
export const MEDIA_RECOVERY_LIMIT = 3;
export class MediaLeaseRecoveryExhaustedError extends Error {
  constructor(readonly expiredBefore: Date) {
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
  if (recovery && job.recoveryCount >= MEDIA_RECOVERY_LIMIT)
    return { kind: 'EXHAUSTED' as const, expiredBefore: staleBefore };
  return {
    kind: 'CLAIM' as const,
    recovery,
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

interface MediaExecution {
  id: string;
  ownerId: string;
  libraryMode: 'MATERIAL' | 'PHOTO';
  assetId: string;
  assetRevision: number;
  leaseVersion: number;
}
export function mediaExecutionGuard(job: MediaExecution, expiredBefore?: Date) {
  return {
    id: job.id,
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    assetId: job.assetId,
    assetRevision: job.assetRevision,
    status: 'PROCESSING' as const,
    leaseVersion: job.leaseVersion,
    ...(expiredBefore ? { lockedAt: { lt: expiredBefore } } : {}),
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
  input: { message: string; permanent: boolean; now?: Date; expiredBefore?: Date },
) {
  const now = input.now ?? new Date();
  const terminal =
    input.permanent ||
    job.attempts >= (job.kind === 'RENDER_EDITED_COPY' ? 3 : MEDIA_FAILURE_LIMIT);
  const data = terminal
    ? {
        status: 'FAILED' as const,
        completedAt: now,
        lockedAt: null,
        lastError: input.message.slice(0, 1000),
      }
    : {
        status: 'PENDING' as const,
        availableAt: new Date(
          now.getTime() + Math.min(3600, 2 ** Math.min(job.attempts, MEDIA_FAILURE_LIMIT)) * 1000,
        ),
        lockedAt: null,
        lastError: input.message.slice(0, 1000),
      };
  return { terminal, where: mediaExecutionGuard(job, input.expiredBefore), data };
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
