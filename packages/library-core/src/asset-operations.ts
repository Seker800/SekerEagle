export const ASSET_OPERATION_KINDS = [
  'SEND',
  'TRASH',
  'RESTORE',
  'EMPTY_TRASH',
  'DUPLICATE_SCAN',
  'DUPLICATE_CLEANUP',
] as const;
export type AssetOperationKind = (typeof ASSET_OPERATION_KINDS)[number];
export interface AssetOperationSummary {
  undoOf?: string;
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

/** Terminal per-resource facts; transport pages are internal batching, not a selection limit. */
export interface AssetOperationReceipt {
  groupSignature?: string;
  assetIds: string[];
  status: string;
  errorCode: string | null;
}
export interface AssetMembershipFact {
  id: string;
  rowVersion: number | null;
  state: 'ACTIVE' | 'TRASH' | 'UNAVAILABLE';
}
export interface AssetOperationResults {
  membership: AssetMembershipFact[];
  operation: AssetOperationSummary;
  revision: string;
  receipts: AssetOperationReceipt[];
  nextCursor: number | null;
}
