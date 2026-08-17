import type { EagleImportManifestChunkInput } from './eagle-app-import-manifest';
import type { EagleImportItemAction, EagleImportItemStatus } from './eagle-app-import-status';

export const EAGLE_IMPORTS_REPOSITORY = Symbol('EAGLE_IMPORTS_REPOSITORY');

export interface CreateEagleImportRunInput {
  idempotencyKey: string;
  manifestVersion: number;
  externalLibraryId: string;
  libraryName: string;
  sourceModifiedAt: Date | null;
  declaredItemCount: number;
  declaredByteSize: number;
}

export interface EagleImportRunView {
  id: string;
  externalLibraryId: string;
  idempotencyKey: string;
  manifestVersion: number;
  status: string;
  declaredItemCount: number;
  declaredByteSize: number;
  stagedItemCount: number;
  importedItemCount: number;
  skippedItemCount: number;
  failedItemCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EagleImportItemView {
  id: string;
  sourceItemId: string;
  displayName: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  status: EagleImportItemStatus;
  action: EagleImportItemAction | null;
  attemptCount: number;
  warningCodes: string[];
  errorCode: string | null;
  errorMessage: string | null;
  assetId: string | null;
  completedAt: Date | null;
  updatedAt: Date;
  activeUpload: {
    sessionId: string;
    status: string;
    partSizeBytes: number;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date;
  } | null;
}

export interface EagleImportItemCounts {
  stagedItemCount: number;
  importedItemCount: number;
  skippedItemCount: number;
  failedItemCount: number;
}

export interface EagleImportsRepository {
  createRun(ownerId: string, input: CreateEagleImportRunInput): Promise<EagleImportRunView>;
  stageManifestChunk(
    ownerId: string,
    runId: string,
    input: EagleImportManifestChunkInput,
  ): Promise<{
    chunkKey: string;
    acceptedItemCount: number;
    skippedItemCount: number;
    replayed: boolean;
  }>;
  preflight(
    ownerId: string,
    runId: string,
  ): Promise<{
    runId: string;
    status: string;
    itemCount: number;
    byteSize: number;
    readyItemCount: number;
    alreadyImportedItemCount: number;
    skippedDeletedItemCount: number;
    skippedUnsupportedItemCount: number;
    warningCount: number;
    newItemCount: number;
    unchangedItemCount: number;
    metadataUpdateItemCount: number;
    contentReplaceItemCount: number;
    uploadItemCount: number;
    uploadByteSize: number;
  }>;
  getRun(ownerId: string, runId: string): Promise<EagleImportRunView>;
  listRuns(
    ownerId: string,
    input: { externalLibraryId?: string; status?: string; limit?: number; cursor?: string },
  ): Promise<{ runs: EagleImportRunView[]; nextCursor: string | null }>;
  listLibraries(ownerId: string): Promise<{
    libraries: Array<{
      externalLibraryId: string;
      displayName: string;
      sourceModifiedAt: Date | null;
      assetCount: number;
      lastImportedAt: Date | null;
    }>;
  }>;
  listItems(
    ownerId: string,
    runId: string,
    input: { limit?: number; cursor?: string; status?: EagleImportItemStatus },
  ): Promise<{ items: EagleImportItemView[]; nextCursor: string | null }>;
  retryItem(ownerId: string, runId: string, itemId: string): Promise<EagleImportItemView>;
  resetUpload(ownerId: string, runId: string, itemId: string): Promise<EagleImportItemView>;
  cancel(ownerId: string, runId: string): Promise<{ runId: string; status: string }>;
  reconcile(
    ownerId: string,
    runId: string,
  ): Promise<{
    runId: string;
    consistent: boolean;
    staleMappings: number;
    orphanedActiveSessions: number;
    expiredActiveSessions: number;
    completedSessionsPendingConvergence: number;
    contentHashMismatches: number;
    recorded: EagleImportItemCounts;
    actual: EagleImportItemCounts;
  }>;
  prepareUploadStart(
    ownerId: string,
    runId: string,
    itemId: string,
  ): Promise<
    | {
        kind: 'CREATE';
        replacedSessionId: string | null;
        action: EagleImportItemAction | null;
        assetId: string | null;
        contentSha256: string | null;
      }
    | { kind: 'RESUME'; sessionId: string }
    | { kind: 'FINALIZING'; sessionId: string | null }
    | { kind: 'IMPORTED'; assetId: string | null }
  >;
  bindUploadSession(input: {
    ownerId: string;
    runId: string;
    runItemId: string;
    uploadSessionId: string;
    fileName: string;
    mimeType: string;
    size: bigint;
  }): Promise<{ accepted: boolean; activeUploadSessionId: string }>;
  finalizeUpload(
    ownerId: string,
    uploadSessionId: string,
    assetId: string,
  ): Promise<{
    runId: string;
    runItemId: string;
    action: EagleImportItemAction | null;
    attemptCount: number;
    byteSize: number;
  } | null>;
  markUploadFailed(
    ownerId: string,
    uploadSessionId: string,
    error: unknown,
    context: { terminal: boolean; permanent: boolean },
  ): Promise<void>;
  expireUploadSession(ownerId: string, uploadSessionId: string, expiredAt: Date): Promise<boolean>;
  reconcileStaleUploadSessions(): Promise<number>;
  backfillTerminalProgress(limit: number): Promise<{ runsReconciled: number; itemsMarked: number }>;
  projectTerminalItemProgress(limit: number): Promise<number>;
  pruneTerminalRuns(input: {
    retentionDays: number;
    keepPerLibrary: number;
    limit: number;
  }): Promise<number>;
}

