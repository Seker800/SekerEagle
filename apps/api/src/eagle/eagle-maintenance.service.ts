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
    return { completedJobsDeleted, importRunsDeleted };
  }

  private async runScheduledMaintenance(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runMaintenance();
      if (result.completedJobsDeleted || result.importRunsDeleted) {
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
