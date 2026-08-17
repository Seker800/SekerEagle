export const ACTIVE_EAGLE_IMPORT_ITEM_STATUSES = ['STAGED', 'UPLOADING', 'FINALIZING'] as const;

export function canStageEagleImportManifest(runStatus: string): boolean {
  return runStatus === 'DRAFT';
}

export function canPreflightEagleImport(runStatus: string): boolean {
  return runStatus === 'DRAFT' || runStatus === 'PREFLIGHTED';
}

export function canStartEagleImportUpload(runStatus: string, itemStatus: string): boolean {
  return canRunAcceptEagleImportUpload(runStatus) && itemStatus === 'STAGED';
}

export function canRunAcceptEagleImportUpload(runStatus: string): boolean {
  return runStatus === 'PREFLIGHTED' || runStatus === 'RUNNING';
}

export function canFinalizeEagleImportUpload(itemStatus: string): boolean {
  return itemStatus === 'UPLOADING' || itemStatus === 'FINALIZING';
}

export function isTerminalEagleImportItem(itemStatus: string): boolean {
  return ['IMPORTED', 'SKIPPED', 'FAILED', 'CANCELLED'].includes(itemStatus);
}

export function resolveEagleImportRunCompletion(input: {
  activeItemCount: number;
  importedItemCount: number;
  skippedItemCount: number;
  failedItemCount: number;
}): 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' {
  if (input.activeItemCount > 0) return 'RUNNING';
  if (input.failedItemCount === 0) return 'COMPLETED';
  return input.importedItemCount > 0 || input.skippedItemCount > 0 ? 'PARTIAL' : 'FAILED';
}

export function resolveEagleImportAction(input: {
  manifestVersion: number;
  skippedCode: string | null;
  hasMappedAsset: boolean;
  priorMetadataHash: string | null;
  metadataHash: string;
  knownContentSha256: string | null;
  contentSha256: string | null;
}):
  | 'NEW'
  | 'UNCHANGED'
  | 'METADATA_UPDATE'
  | 'CONTENT_REPLACE'
  | 'SKIP_DELETED'
  | 'SKIP_UNSUPPORTED' {
  if (input.skippedCode === 'SOURCE_ITEM_DELETED') return 'SKIP_DELETED';
  if (input.skippedCode === 'UNSUPPORTED_MEDIA') return 'SKIP_UNSUPPORTED';
  if (!input.hasMappedAsset) return 'NEW';
  if (
    input.manifestVersion === 2 &&
    input.knownContentSha256 !== null &&
    input.contentSha256 !== input.knownContentSha256
  ) {
    return 'CONTENT_REPLACE';
  }
  return input.priorMetadataHash === input.metadataHash ? 'UNCHANGED' : 'METADATA_UPDATE';
}
