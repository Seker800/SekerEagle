import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EagleUploadService } from './eagle-upload.service';
import { EagleImportsService } from './import/eagle-app-import.service';
import { ObjectStorageService } from '../storage/object-storage.service';

const RECOVERY_INTERVAL_MS = 60_000;

@Injectable()
export class EagleUploadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EagleUploadRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: EagleUploadService,
    private readonly imports: EagleImportsService,
    private readonly storage: ObjectStorageService,
  ) {}

  onModuleInit(): void {
    void this.recoverPendingFinalizations();
    this.timer = setInterval(() => void this.recoverPendingFinalizations(), RECOVERY_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async recoverPendingFinalizations(): Promise<void> {
    const staleInitiatedCutoff = new Date(Date.now() - RECOVERY_INTERVAL_MS);
    const staleFinalizingCutoff = new Date(Date.now() - 5 * RECOVERY_INTERVAL_MS);
    await this.prisma.uploadSession.updateMany({
      where: { status: 'FINALIZING', finalizationStartedAt: { lt: staleFinalizingCutoff } },
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
      },
      select: { id: true, uploaderId: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const session of sessions) {
      try {
        const completed = await this.uploads.recoverUploadSession(session.id);
        if (completed) {
          await this.imports.finalizeUpload(
            session.uploaderId,
            session.id,
            completed.assetId,
          );
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
    await this.recoverObjectCleanup();
  }

  private async recoverObjectCleanup(): Promise<void> {
    const sessions = await this.prisma.uploadSession.findMany({
      where: { objectCleanupPending: true, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { id: true, objectKey: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });
    for (const session of sessions) {
      try {
        await this.storage.deleteObject(session.objectKey);
        await this.prisma.uploadSession.updateMany({
          where: { id: session.id, objectCleanupPending: true },
          data: { objectCleanupPending: false },
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
      },
      select: { uploadSessionId: true, retiredObjectKeys: true },
      take: 50,
    });
    for (const replacement of replacements) {
      try {
        for (const key of replacement.retiredObjectKeys) await this.storage.deleteObject(key);
        await this.prisma.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: replacement.uploadSessionId },
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
