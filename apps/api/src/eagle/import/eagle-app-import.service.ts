import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  canonicalizeEagleImportManifestChunk,
  EagleImportManifestValidationError,
  type EagleImportManifestChunkInput,
} from './eagle-app-import-manifest';
import type { EagleImportItemStatus } from './eagle-app-import-status';
import {
  EAGLE_IMPORTS_REPOSITORY,
  type CreateEagleImportRunInput,
  type EagleImportsRepository,
} from './eagle-app-import.repository';

export type { CreateEagleImportRunInput } from './eagle-app-import.repository';

@Injectable()
export class EagleImportsService {
  private readonly logger = new Logger(EagleImportsService.name);

  constructor(
    @Inject(EAGLE_IMPORTS_REPOSITORY)
    private readonly repository: EagleImportsRepository,
  ) {}

  async createRun(ownerId: string, input: CreateEagleImportRunInput) {
    const startedAt = Date.now();
    const run = await this.repository.createRun(ownerId, input);
    this.log('eagle_import_run_created', {
      ownerId,
      runId: run.id,
      manifestVersion: run.manifestVersion,
      durationMs: Date.now() - startedAt,
    });
    return run;
  }

  async stageManifestChunk(ownerId: string, runId: string, input: EagleImportManifestChunkInput) {
    try {
      const startedAt = Date.now();
      const staged = await this.repository.stageManifestChunk(
        ownerId,
        runId,
        canonicalizeEagleImportManifestChunk(input),
      );
      this.log('eagle_import_manifest_staged', {
        ownerId,
        runId,
        acceptedItemCount: staged.acceptedItemCount,
        skippedItemCount: staged.skippedItemCount,
        replayed: staged.replayed,
        durationMs: Date.now() - startedAt,
      });
      return staged;
    } catch (error) {
      if (error instanceof EagleImportManifestValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async preflight(ownerId: string, runId: string) {
    const startedAt = Date.now();
    const result = await this.repository.preflight(ownerId, runId);
    this.log('eagle_import_preflight_completed', {
      ownerId,
      runId,
      itemCount: result.itemCount,
      uploadItemCount: result.uploadItemCount,
      uploadByteSize: result.uploadByteSize,
      durationMs: Date.now() - startedAt,
    });
    if (result.metadataUpdateItemCount > 0) {
      this.log('eagle_import_item_metadata_updated', {
        ownerId,
        runId,
        itemCount: result.metadataUpdateItemCount,
      });
    }
    return result;
  }

  getRun(ownerId: string, runId: string) {
    return this.repository.getRun(ownerId, runId);
  }

  listRuns(
    ownerId: string,
    input: { externalLibraryId?: string; status?: string; limit?: number; cursor?: string },
  ) {
    return this.repository.listRuns(ownerId, input);
  }

  listLibraries(ownerId: string) {
    return this.repository.listLibraries(ownerId);
  }

  listItems(
    ownerId: string,
    runId: string,
    input: { limit?: number; cursor?: string; status?: EagleImportItemStatus },
  ) {
    return this.repository.listItems(ownerId, runId, input);
  }

  retryItem(ownerId: string, runId: string, itemId: string) {
    return this.repository.retryItem(ownerId, runId, itemId);
  }

  resetUpload(ownerId: string, runId: string, itemId: string) {
    return this.repository.resetUpload(ownerId, runId, itemId);
  }

  prepareUploadStart(ownerId: string, runId: string, itemId: string) {
    return this.repository.prepareUploadStart(ownerId, runId, itemId);
  }

  cancel(ownerId: string, runId: string) {
    return this.repository.cancel(ownerId, runId);
  }

  async reconcile(ownerId: string, runId: string) {
    const result = await this.repository.reconcile(ownerId, runId);
    if (!result.consistent) {
      this.log('eagle_import_reconcile_inconsistency', {
        ownerId,
        runId,
        staleMappings: result.staleMappings,
        orphanedActiveSessions: result.orphanedActiveSessions,
        expiredActiveSessions: result.expiredActiveSessions,
        completedSessionsPendingConvergence: result.completedSessionsPendingConvergence,
        contentHashMismatches: result.contentHashMismatches,
      });
    }
    return result;
  }

  backfillTerminalProgress(limit: number) {
    return this.repository.backfillTerminalProgress(limit);
  }

  bindUploadSession(input: {
    ownerId: string;
    runId: string;
    runItemId: string;
    uploadSessionId: string;
    fileName: string;
    mimeType: string;
    size: bigint;
  }) {
    return this.repository.bindUploadSession(input);
  }

  async finalizeUpload(ownerId: string, uploadSessionId: string, assetId: string) {
    const completed = await this.repository.finalizeUpload(ownerId, uploadSessionId, assetId);
    if (!completed) return;
    const details = { ...completed, ownerId, uploadSessionId, assetId };
    this.log(
      completed.action === 'CONTENT_REPLACE'
        ? 'eagle_import_item_content_replaced'
        : 'eagle_import_item_completed',
      details,
    );
  }

  markUploadFailed(
    ownerId: string,
    uploadSessionId: string,
    error: unknown,
    context: { terminal: boolean; permanent: boolean },
  ) {
    const response = error instanceof BadRequestException ? error.getResponse() : null;
    const domainErrorCode =
      response && typeof response === 'object' && 'code' in response ? response.code : null;
    this.log('eagle_import_item_failed', {
      ownerId,
      uploadSessionId,
      terminal: context.terminal,
      permanent: context.permanent,
      errorCode:
        typeof domainErrorCode === 'string'
          ? domainErrorCode
          : error instanceof BadRequestException
            ? 'INVALID_MEDIA'
            : 'UPLOAD_FINALIZATION_FAILED',
    });
    return this.repository.markUploadFailed(ownerId, uploadSessionId, error, context);
  }

  async expireUploadSession(
    ownerId: string,
    uploadSessionId: string,
    expiredAt: Date,
  ): Promise<boolean> {
    const expired = await this.repository.expireUploadSession(ownerId, uploadSessionId, expiredAt);
    if (expired) {
      this.log('eagle_import_session_expired', { ownerId, uploadSessionId });
    }
    return expired;
  }

  reconcileStaleUploadSessions() {
    return this.repository.reconcileStaleUploadSessions();
  }

  projectTerminalItemProgress(limit = 500) {
    return this.repository.projectTerminalItemProgress(limit);
  }

  pruneTerminalRuns(input: { retentionDays: number; keepPerLibrary: number; limit: number }) {
    return this.repository.pruneTerminalRuns(input);
  }

  private log(event: string, details: Record<string, unknown>): void {
    this.logger.log(JSON.stringify({ event, ...details }));
  }
}

