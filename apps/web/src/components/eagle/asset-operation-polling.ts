import type { AssetOperationSummary } from '@sekereagle/library-core';

type Progress = Pick<
  AssetOperationSummary,
  'id' | 'completed' | 'queued' | 'running' | 'failed' | 'cancelled'
>;

/** Request pacing only: progress and explicit invalidation always restart fast observation. */
export function createOperationPollSchedule() {
  let signature = '',
    changedAt = 0,
    errorRevision = 0,
    errors = 0;
  return (
    rows: readonly Progress[] | undefined,
    pending: boolean,
    error: number,
    now = Date.now(),
  ) => {
    if (error) {
      if (error !== errorRevision) errors++;
      errorRevision = error;
      return Math.min(60000, 5000 * 2 ** Math.min(4, errors - 1));
    }
    errors = 0;
    const next = JSON.stringify([
      pending,
      rows?.map(({ id, completed, queued, running, failed, cancelled }) => [
        id,
        completed,
        queued,
        running,
        failed,
        cancelled,
      ]),
    ]);
    if (next !== signature) {
      signature = next;
      changedAt = now;
    }
    if (!pending && !rows?.some((row) => row.running || row.queued)) return 60000;
    const unchangedFor = now - changedAt;
    return unchangedFor >= 30000 ? 10000 : unchangedFor >= 10000 ? 5000 : 2000;
  };
}
