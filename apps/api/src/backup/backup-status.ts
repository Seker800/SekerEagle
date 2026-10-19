export interface BackupStatus {
  configured: boolean;
  target: string | null;
  status: 'never' | 'running' | 'succeeded' | 'failed';
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  nextScheduledAt: string | null;
  overdue: boolean;
  cleanupPending: boolean;
  quarantinePending: boolean;
}

const timestamp = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

// The host owns this projection. Never expose paths, credentials, snapshots or logs.
export function publicBackupStatus(value: unknown, now = Date.now()): BackupStatus {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const configured = data.configured === true;
  const lastSuccessAt = timestamp(data.lastSuccessAt);
  const nextScheduledAt = timestamp(data.nextScheduledAt);
  const status = ['running', 'succeeded', 'failed'].includes(String(data.status))
    ? (data.status as BackupStatus['status'])
    : 'never';
  return {
    configured,
    cleanupPending: data.cleanupPending === true,
    quarantinePending: data.quarantinePending === true,
    target: configured && data.target === 'SekerDesign' ? 'SekerDesign' : null,
    status,
    lastAttemptAt: timestamp(data.lastAttemptAt),
    lastSuccessAt,
    nextScheduledAt,
    overdue:
      configured &&
      status !== 'running' &&
      ((lastSuccessAt !== null && now - Date.parse(lastSuccessAt) > 15 * 86400_000) ||
        (nextScheduledAt !== null && now - Date.parse(nextScheduledAt) > 86400_000)),
  };
}
