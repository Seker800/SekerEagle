import { Logger } from '@nestjs/common';
import type { LibraryMode } from '@prisma/client';
import type { EagleUploadService } from './eagle/eagle-upload.service';
import type { EagleImportsService } from './eagle/import/eagle-app-import.service';
import type { PrismaService } from './prisma/prisma.service';

/** Mirrors UploadSession.finalizationAttempts: ten attempts make the failure terminal. */
const MAX_ATTEMPTS = 10;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

type ClaimedJob = {
  id: string;
  uploadSessionId: string;
  attempts: number;
  libraryMode: LibraryMode;
};

/**
 * Runs only in the independent operations process. Claims durable upload
 * finalization jobs, inspects each object with bounded memory and publishes
 * through the original upload publication transaction.
 */
export class UploadFinalizationExecutor {
  private readonly logger = new Logger(UploadFinalizationExecutor.name);
  private running = false;
  private closing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: Record<LibraryMode, EagleUploadService>,
    private readonly imports: EagleImportsService,
  ) {}

  /** Stop after the in-flight job; the durable queue keeps the rest for the next process. */
  stop(): void {
    this.closing = true;
  }

  async tick(): Promise<void> {
    if (this.running || this.closing) return;
    this.running = true;
    try {
      while (!this.closing && (await this.runOnce())) {
        // Drain the queued uploads one at a time; memory stays bounded.
      }
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<boolean> {
    const [job] = await this.prisma.$queryRaw<ClaimedJob[]>`
      WITH candidate AS (
        SELECT j.id FROM "UploadFinalizationJob" j
        WHERE (j.status = 'PENDING' AND j."availableAt" <= now())
           OR (j.status = 'PROCESSING' AND j."lockedAt" < now() - interval '5 minutes')
        ORDER BY j."availableAt", j."createdAt"
        FOR UPDATE OF j SKIP LOCKED
        LIMIT 1
      )
      UPDATE "UploadFinalizationJob" j
      SET status = 'PROCESSING', "lockedAt" = now(), attempts = j.attempts + 1, "updatedAt" = now()
      FROM candidate c
      WHERE j.id = c.id
      RETURNING j.id, j."uploadSessionId", j.attempts,
        (SELECT s."libraryMode" FROM "UploadSession" s WHERE s.id = j."uploadSessionId") AS "libraryMode"
    `;
    if (!job) return false;
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: job.uploadSessionId },
      select: {
        status: true,
        uploaderId: true,
        finalizationAttempts: true,
        lastError: true,
        eagleAssetId: true,
      },
    });
    if (!session || session.status === 'ABORTED') {
      await this.completeJob(job.id);
      return true;
    }
    if (session.status === 'COMPLETED') {
      await this.finalizeImport(job, session.uploaderId, session.eagleAssetId);
      return true;
    }
    try {
      const completed = await this.uploads[job.libraryMode].recoverUploadSession(
        job.uploadSessionId,
      );
      const current = completed
        ? null
        : await this.prisma.uploadSession.findFirst({
            where: { id: job.uploadSessionId },
            select: {
              status: true,
              finalizationAttempts: true,
              lastError: true,
              eagleAssetId: true,
            },
          });
      const assetId = completed?.assetId ?? current?.eagleAssetId ?? null;
      if (assetId) {
        try {
          await this.imports.finalizeUpload(session.uploaderId, job.uploadSessionId, assetId);
        } catch (error) {
          await this.retryJob(job.id, job.attempts, error);
          return true;
        }
      }
      if (completed || current?.status === 'COMPLETED' || current?.status === 'ABORTED') {
        await this.completeJob(job.id);
      } else if (current?.status === 'FAILED' && current.finalizationAttempts >= MAX_ATTEMPTS) {
        await this.failJob(job.id, current.finalizationAttempts, current.lastError);
      } else {
        await this.retryJob(job.id, job.attempts, current?.lastError ?? 'FINALIZATION_IN_PROGRESS');
      }
    } catch (error) {
      const current = await this.prisma.uploadSession.findFirst({
        where: { id: job.uploadSessionId },
        select: { status: true, finalizationAttempts: true, lastError: true, eagleAssetId: true },
      });
      if (current?.status === 'COMPLETED') {
        await this.finalizeImport(job, session.uploaderId, current.eagleAssetId);
      } else if (current?.status === 'ABORTED') {
        await this.completeJob(job.id);
      } else if (
        job.attempts >= MAX_ATTEMPTS ||
        (current?.status === 'FAILED' && current.finalizationAttempts >= MAX_ATTEMPTS)
      ) {
        await this.failJob(job.id, job.attempts, current?.lastError ?? error);
      } else {
        await this.retryJob(job.id, job.attempts, current?.lastError ?? error);
      }
    }
    return true;
  }

  /** Import finalization is idempotent and must not be lost if publication already succeeded. */
  private async finalizeImport(
    job: ClaimedJob,
    uploaderId: string,
    assetId: string | null,
  ): Promise<void> {
    if (assetId) {
      try {
        await this.imports.finalizeUpload(uploaderId, job.uploadSessionId, assetId);
      } catch (error) {
        await this.retryJob(job.id, job.attempts, error);
        return;
      }
    }
    await this.completeJob(job.id);
  }

  private async completeJob(id: string) {
    await this.prisma.uploadFinalizationJob.update({
      where: { id },
      data: { status: 'COMPLETED', lockedAt: null, lastError: null },
    });
  }

  private async failJob(id: string, attempts: number, detail?: unknown) {
    await this.prisma.uploadFinalizationJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        lockedAt: null,
        attempts,
        lastError: jobError(detail),
      },
    });
  }

  private async retryJob(id: string, attempts: number, detail?: unknown) {
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.max(1, attempts));
    await this.prisma.uploadFinalizationJob.update({
      where: { id },
      data: {
        status: 'PENDING',
        availableAt: new Date(Date.now() + delay),
        lockedAt: null,
        lastError: jobError(detail),
      },
    });
    this.logger.warn(`upload_finalization_retry ${JSON.stringify({ id, attempts, delay })}`);
  }
}

function jobError(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  const message =
    detail instanceof Error
      ? detail.message
      : typeof detail === 'string'
        ? detail
        : (JSON.stringify(detail) ?? '');
  return message.slice(0, 2000) || null;
}
