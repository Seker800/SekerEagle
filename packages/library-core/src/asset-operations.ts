export const ASSET_OPERATION_KINDS = ['SEND', 'TRASH', 'RESTORE', 'EMPTY_TRASH', 'DUPLICATE_SCAN', 'DUPLICATE_CLEANUP'] as const;
export type AssetOperationKind = (typeof ASSET_OPERATION_KINDS)[number];
export interface AssetOperationSummary {
  id: string;
  kind: AssetOperationKind;
  libraryMode: LibraryModeForOperation;
  total: number;
  completed: number;
  /** Idempotent no-ops, included in completed for older clients. */
  skipped?: number;
  failed: number;
  queued: number;
  running: number;
  cancelled: number;
  state: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'STOPPED';
  errors: Array<{ code: string; count: number }>;
}
type LibraryModeForOperation = 'MATERIAL' | 'PHOTO';
export function assetOperationState(
  counts: Pick<AssetOperationSummary, 'queued' | 'running' | 'failed' | 'cancelled'>,
): AssetOperationSummary['state'] {
  if (counts.running) return 'RUNNING';
  if (counts.queued) return 'QUEUED';
  return counts.failed || counts.cancelled ? 'STOPPED' : 'COMPLETED';
}
