export const ASSET_OPERATION_KINDS = [
  'SEND',
  'TRASH',
  'RESTORE',
  'EMPTY_TRASH',
  'DUPLICATE_SCAN',
  'DUPLICATE_CLEANUP',
  'METADATA_COMMAND',
  'BACKGROUND_COMMAND',
] as const;
export type AssetOperationKind = (typeof ASSET_OPERATION_KINDS)[number];
/** Direct commands are opt-in: adding a kind never expands the public DTO. */
export const DIRECT_ASSET_OPERATION_KINDS = [
  'SEND',
  'TRASH',
  'RESTORE',
  'EMPTY_TRASH',
] as const satisfies readonly AssetOperationKind[];
export type DirectAssetOperationKind = (typeof DIRECT_ASSET_OPERATION_KINDS)[number];
export type MetadataOperationKind = 'TRASH' | 'RESTORE' | 'DUPLICATE_CLEANUP' | 'METADATA_COMMAND';
type OperationProtocolFor<K extends AssetOperationKind> = {
  admission: K extends DirectAssetOperationKind
    ? 'DIRECT'
    : K extends 'METADATA_COMMAND' | 'BACKGROUND_COMMAND'
      ? 'DOMAIN'
      : 'DUPLICATES';
  execution: K extends MetadataOperationKind
    ? 'METADATA'
    : K extends 'BACKGROUND_COMMAND'
      ? 'COMMAND'
      : K extends 'SEND'
        ? 'TRANSFER'
        : K extends 'DUPLICATE_SCAN'
          ? 'SCAN'
          : 'CUTOFF';
  snapshot: K extends 'METADATA_COMMAND' | 'BACKGROUND_COMMAND'
    ? 'COMMAND'
    : K extends 'SEND' | 'TRASH'
      ? 'RESOURCE_VERSIONS'
      : K extends 'RESTORE'
        ? 'RESOURCE_VERSIONS_OR_UNDO'
        : K extends 'DUPLICATE_CLEANUP'
          ? 'CLEANUP_REVIEW'
          : K extends 'DUPLICATE_SCAN'
            ? 'SCAN_STAGE'
            : 'CREATED_AT_CUTOFF';
  membership: K extends 'SEND'
    ? 'SOURCE_REMOVED'
    : K extends 'TRASH' | 'DUPLICATE_CLEANUP'
      ? 'TRASH'
      : K extends 'RESTORE'
        ? 'ACTIVE'
        : K extends 'EMPTY_TRASH'
          ? 'PURGED_AT_CUTOFF'
          : 'UNCHANGED';
  compensation: K extends 'TRASH' | 'DUPLICATE_CLEANUP' ? 'RESTORE' : null;
};
/** Execution, receipts and compensation are explicit for every persisted kind. */
export const ASSET_OPERATION_PROTOCOLS = {
  METADATA_COMMAND: {
    admission: 'DOMAIN',
    execution: 'METADATA',
    snapshot: 'COMMAND',
    membership: 'UNCHANGED',
    compensation: null,
  },
  BACKGROUND_COMMAND: {
    admission: 'DOMAIN',
    execution: 'COMMAND',
    snapshot: 'COMMAND',
    membership: 'UNCHANGED',
    compensation: null,
  },
  SEND: {
    admission: 'DIRECT',
    execution: 'TRANSFER',
    snapshot: 'RESOURCE_VERSIONS',
    membership: 'SOURCE_REMOVED',
    compensation: null,
  },
  TRASH: {
    admission: 'DIRECT',
    execution: 'METADATA',
    snapshot: 'RESOURCE_VERSIONS',
    membership: 'TRASH',
    compensation: 'RESTORE',
  },
  RESTORE: {
    admission: 'DIRECT',
    execution: 'METADATA',
    snapshot: 'RESOURCE_VERSIONS_OR_UNDO',
    membership: 'ACTIVE',
    compensation: null,
  },
  EMPTY_TRASH: {
    admission: 'DIRECT',
    execution: 'CUTOFF',
    snapshot: 'CREATED_AT_CUTOFF',
    membership: 'PURGED_AT_CUTOFF',
    compensation: null,
  },
  DUPLICATE_SCAN: {
    admission: 'DUPLICATES',
    execution: 'SCAN',
    snapshot: 'SCAN_STAGE',
    membership: 'UNCHANGED',
    compensation: null,
  },
  DUPLICATE_CLEANUP: {
    admission: 'DUPLICATES',
    execution: 'METADATA',
    snapshot: 'CLEANUP_REVIEW',
    membership: 'TRASH',
    compensation: 'RESTORE',
  },
} as const satisfies { [K in AssetOperationKind]: OperationProtocolFor<K> };
export function assetOperationProtocol(kind: string) {
  return Object.prototype.hasOwnProperty.call(ASSET_OPERATION_PROTOCOLS, kind)
    ? ASSET_OPERATION_PROTOCOLS[kind as AssetOperationKind]
    : undefined;
}

export interface AssetOperationSummary {
  commandType?: string;
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
