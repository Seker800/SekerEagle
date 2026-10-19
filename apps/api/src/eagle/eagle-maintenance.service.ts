import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EagleImportsService } from './import/eagle-app-import.service';

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1_000;
const COMPLETED_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const COMPLETED_JOB_BATCH_SIZE = 10_000;

@Injectable()
export class EagleMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EagleMaintenanceService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: EagleImportsService,
  ) {}

  onModuleInit(): void {
    void this.runScheduledMaintenance();
    this.timer = setInterval(() => void this.runScheduledMaintenance(), MAINTENANCE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runMaintenance(now = new Date()) {
    await this.imports.reconcileStaleUploadSessions();
    await this.imports.projectTerminalItemProgress(500);
    await this.imports.backfillTerminalProgress(500);
    const completedBefore = new Date(now.getTime() - COMPLETED_JOB_RETENTION_MS);
    const completedJobsDeleted = await this.prisma.$executeRaw`
      WITH doomed AS (
        SELECT "id"
        FROM "EagleMediaJob"
        WHERE "status" = 'COMPLETED'
          AND "completedAt" < ${completedBefore}
        ORDER BY "completedAt" ASC, "id" ASC
        LIMIT ${COMPLETED_JOB_BATCH_SIZE}
      )
      DELETE FROM "EagleMediaJob" AS job
      USING doomed
      WHERE job."id" = doomed."id"
    `;
    const importRunsDeleted = await this.imports.pruneTerminalRuns({
      retentionDays: 30,
      keepPerLibrary: 10,
      limit: 100,
    });
    const abandonedBefore = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
    const abandonedImageEdits = await this.prisma.$executeRaw`
      WITH expired AS (
        UPDATE "EagleImageEdit" SET status='EXPIRED', "updatedAt"=${now}
        WHERE id IN (
          SELECT id FROM "EagleImageEdit" WHERE status='PENDING' AND "updatedAt" < ${abandonedBefore}
          ORDER BY "updatedAt", id LIMIT 100 FOR UPDATE SKIP LOCKED
        ) RETURNING id, "ownerId", "libraryMode", "targetKey"
      )
      INSERT INTO "EagleObjectDeletion" (id, "ownerId", "libraryMode", "objectKeys", prefixes, "updatedAt")
      SELECT 'image-edit:' || id, "ownerId", "libraryMode", ARRAY["targetKey"], ARRAY[]::text[], ${now} FROM expired
    `;
    return { completedJobsDeleted, importRunsDeleted, abandonedImageEdits };
  }

  private async runScheduledMaintenance(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runMaintenance();
      if (result.completedJobsDeleted || result.importRunsDeleted || result.abandonedImageEdits) {
        this.logger.log(JSON.stringify({ event: 'eagle_maintenance_pruned', ...result }));
      }
    } catch (error) {
      this.logger.warn(
        `eagle_maintenance_failed ${JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown',
        })}`,
      );
    } finally {
      this.running = false;
    }
  }
}
