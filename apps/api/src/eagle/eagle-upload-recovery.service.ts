import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EagleUploadService } from './eagle-upload.service';
import { EagleImportsService } from './import/eagle-app-import.service';

const RECOVERY_INTERVAL_MS = 60_000;

@Injectable()
export class EagleUploadRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EagleUploadRecoveryService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: EagleUploadService,
    private readonly imports: EagleImportsService,
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
  }
}
