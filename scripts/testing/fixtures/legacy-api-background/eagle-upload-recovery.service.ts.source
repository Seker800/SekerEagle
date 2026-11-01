import type { LibraryMode } from '@prisma/client';
import { LIBRARY_MODE } from './library-mode';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EagleUploadService } from './eagle-upload.service';
import { EagleImportsService } from './import/eagle-app-import.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const RECOVERY_INTERVAL_MS = 60_000;

@Injectable()
export class EagleUploadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EagleUploadRecoveryService.name);
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: EagleUploadService,
    private readonly imports: EagleImportsService,
    private readonly storage: ObjectStorageService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}

  onModuleInit(): void {
    if (process.env.EAGLE_UPLOAD_RECOVERY_ENABLED === 'false') return;
    void this.recoverPendingFinalizations();
    this.timer = setInterval(() => void this.recoverPendingFinalizations(), RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recoverPendingFinalizations(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.recover();
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'UPLOAD_RECOVERY_FAILED');
    } finally {
      this.running = false;
    }
  }

  private async recover(): Promise<void> {
    const staleInitiatedCutoff = new Date(Date.now() - RECOVERY_INTERVAL_MS);
    const staleFinalizingCutoff = new Date(Date.now() - 5 * RECOVERY_INTERVAL_MS);
    await this.prisma.uploadSession.updateMany({
      where: {
        status: 'FINALIZING',
        finalizationStartedAt: { lt: staleFinalizingCutoff },
        libraryMode: this.libraryMode,
      },
      data: { status: 'FAILED', lastError: 'Finalization lease expired before completion.' },
    });
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        finalizationAttempts: { lt: 10 },
        OR: [
          { status: { in: ['ASSEMBLED', 'FAILED'] } },
          {
            status: 'INITIATED',
            completionParts: { not: Prisma.DbNull },
            updatedAt: { lt: staleInitiatedCutoff },
          },
        ],
        libraryMode: this.libraryMode,
      },
      select: { id: true, uploaderId: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const session of sessions) {
      try {
        const completed = await this.uploads.recoverUploadSession(session.id);
        if (completed) {
          await this.imports.finalizeUpload(session.uploaderId, session.id, completed.assetId);
        }
      } catch (error) {
        await this.imports
          .markUploadFailed(session.uploaderId, session.id, error, {
            terminal: false,
            permanent: false,
          })
          .catch(() => undefined);
        this.logger.warn(
          `upload_finalization_recovery_failed ${JSON.stringify({
            sessionId: session.id,
            error: error instanceof Error ? error.message : 'Unknown',
          })}`,
        );
      }
    }
    // Durable terminal markers keep failed cleanup retryable after a process crash.
    await this.prisma.uploadSession.updateMany({
      where: {
        libraryMode: this.libraryMode,
        status: 'INITIATED',
        completionParts: { equals: Prisma.DbNull },
        updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      data: {
        status: 'ABORTED',
        abortedAt: new Date(),
        objectCleanupPending: true,
        lastError: 'UPLOAD_EXPIRED',
      },
    });
    await this.prisma.uploadSession.updateMany({
      where: {
        libraryMode: this.libraryMode,
        status: 'FAILED',
        finalizationAttempts: { gte: 10 },
        eagleAssetId: null,
        objectCleanupPending: false,
      },
      data: { objectCleanupPending: true },
    });
    await this.recoverObjectCleanup();
  }

  private async recoverObjectCleanup(): Promise<void> {
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        objectCleanupPending: true,
        status: { in: ['COMPLETED', 'FAILED', 'ABORTED'] },
        libraryMode: this.libraryMode,
      },
      select: { id: true, objectKey: true, multipartUploadId: true, status: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const session of sessions) {
      try {
        if (session.status === 'ABORTED')
          await this.storage
            .abortMultipartUpload(session.objectKey, session.multipartUploadId)
            .catch((error) => {
              if (!(error instanceof Error) || error.name !== 'NoSuchUpload') throw error;
            });
        await this.storage.deleteObject(session.objectKey);
        await this.prisma.uploadSession.updateMany({
          where: { id: session.id, objectCleanupPending: true, libraryMode: this.libraryMode },
          data: {
            objectCleanupPending: false,
            ...(session.status === 'FAILED'
              ? { status: 'ABORTED' as const, abortedAt: new Date() }
              : {}),
          },
        });
      } catch (error) {
        this.logger.warn(
          `upload_object_cleanup_failed ${JSON.stringify({
            sessionId: session.id,
            error: error instanceof Error ? error.message : 'Unknown',
          })}`,
        );
      }
    }

    const replacements = await this.prisma.eagleUploadSessionState.findMany({
      where: {
        retiredObjectKeys: { isEmpty: false },
        replacementAsset: { lifecycleStatus: 'READY' },
        libraryMode: this.libraryMode,
      },
      select: { uploadSessionId: true, retiredObjectKeys: true },
      take: 50,
    });
    for (const replacement of replacements) {
      try {
        for (const key of replacement.retiredObjectKeys) await this.storage.deleteObject(key);
        await this.prisma.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: replacement.uploadSessionId, libraryMode: this.libraryMode },
          data: { retiredObjectKeys: [], replacementAssetId: null },
        });
      } catch (error) {
        this.logger.warn(
          `replacement_object_cleanup_failed ${JSON.stringify({
            uploadSessionId: replacement.uploadSessionId,
            error: error instanceof Error ? error.message : 'Unknown',
          })}`,
        );
      }
    }
  }
}
