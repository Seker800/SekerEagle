import { Inject, Injectable } from '@nestjs/common';
import { EagleImportItemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  SEKER_EAGLE_INGESTION_PORT,
  type SekerEagleIngestionPort,
} from '../../../seker-eagle-ingestion.port';
import type {
  CreateEagleImportRunInput,
  EagleImportsRepository,
} from '../../eagle-app-import.repository';
import type { EagleImportManifestChunkInput } from '../../eagle-app-import-manifest';
import { ImportItemRepository } from './import-item.repository';
import { ImportProgressRepository } from './import-progress.repository';
import { ImportRunRepository } from './import-run.repository';

@Injectable()
export class PrismaEagleImportsRepository implements EagleImportsRepository {
  private readonly runs: ImportRunRepository;
  private readonly items: ImportItemRepository;
  private readonly progress: ImportProgressRepository;

  constructor(
    prisma: PrismaService,
    @Inject(SEKER_EAGLE_INGESTION_PORT)
    ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  ) {
    this.runs = new ImportRunRepository(prisma, ingestion);
    this.items = new ImportItemRepository(prisma, ingestion);
    this.progress = new ImportProgressRepository(prisma);
  }

  createRun(ownerId: string, input: CreateEagleImportRunInput) {
    return this.runs.createRun(ownerId, input);
  }

  stageManifestChunk(ownerId: string, runId: string, input: EagleImportManifestChunkInput) {
    return this.runs.stageManifestChunk(ownerId, runId, input);
  }

  preflight(ownerId: string, runId: string) {
    return this.runs.preflight(ownerId, runId);
  }

  getRun(ownerId: string, runId: string) {
    return this.runs.getRun(ownerId, runId);
  }

  listRuns(
    ownerId: string,
    input: { externalLibraryId?: string; status?: string; limit?: number; cursor?: string },
  ) {
    return this.runs.listRuns(ownerId, input);
  }

  listLibraries(ownerId: string) {
    return this.runs.listLibraries(ownerId);
  }

  getUploadItem(ownerId: string, runId: string, itemId: string) {
    return this.items.getUploadItem(ownerId, runId, itemId);
  }

  listItems(
    ownerId: string,
    runId: string,
    input: { limit?: number; cursor?: string; status?: EagleImportItemStatus },
  ) {
    return this.items.listItems(ownerId, runId, input);
  }

  retryItem(ownerId: string, runId: string, itemId: string) {
    return this.items.retryItem(ownerId, runId, itemId);
  }

  resetUpload(ownerId: string, runId: string, itemId: string) {
    return this.items.resetUpload(ownerId, runId, itemId);
  }

  cancel(ownerId: string, runId: string) {
    return this.runs.cancel(ownerId, runId);
  }

  reconcile(ownerId: string, runId: string) {
    return this.progress.reconcile(ownerId, runId);
  }

  prepareUploadStart(ownerId: string, runId: string, itemId: string) {
    return this.items.prepareUploadStart(ownerId, runId, itemId);
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
    return this.items.bindUploadSession(input);
  }

  finalizeUpload(ownerId: string, uploadSessionId: string, assetId: string) {
    return this.items.finalizeUpload(ownerId, uploadSessionId, assetId);
  }

  markUploadFailed(
    ownerId: string,
    uploadSessionId: string,
    error: unknown,
    context: { terminal: boolean; permanent: boolean },
  ) {
    return this.items.markUploadFailed(ownerId, uploadSessionId, error, context);
  }

  expireUploadSession(ownerId: string, uploadSessionId: string, expiredAt: Date) {
    return this.items.expireUploadSession(ownerId, uploadSessionId, expiredAt);
  }

  reconcileStaleUploadSessions() {
    return this.items.reconcileStaleUploadSessions();
  }

  backfillTerminalProgress(limit: number) {
    return this.progress.backfillTerminalProgress(limit);
  }

  projectTerminalItemProgress(limit: number) {
    return this.progress.projectTerminalItemProgress(limit);
  }

  pruneTerminalRuns(input: { retentionDays: number; keepPerLibrary: number; limit: number }) {
    return this.progress.pruneTerminalRuns(input);
  }
}
