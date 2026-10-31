import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EagleLibraryTransfer } from '@prisma/client';
import { assertOwnedObjectKey } from '../storage/object-key';
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
    const transfersExpired = await this.expireLibraryTransfers(now);
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
    return { completedJobsDeleted, importRunsDeleted, transfersExpired };
  }

  async expireLibraryTransfers(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.prisma.$transaction(async (tx) => {
      // Global infrastructure sweep: no asset read is authorized by this query.
      const plans = await tx.$queryRaw<EagleLibraryTransfer[]>`
        SELECT * FROM "EagleLibraryTransfer"
        WHERE status IN ('PENDING', 'ABANDONED') AND "updatedAt" < ${cutoff}
        ORDER BY "updatedAt", id LIMIT 100 FOR UPDATE SKIP LOCKED
      `;
      for (const plan of plans) {
        const items = plan.plan as Array<{
          storageAction?: 'HANDOFF';
          targetKey: string;
          targetId: string;
          renditions?: Array<{ targetKey: string }>;
          pyramid?: { targetPrefix: string };
        }>;
        if (!Array.isArray(items) || !items.length || items.length > 200)
          throw new Error('Invalid transfer cleanup plan');
        const prefixes: string[] = [];
        const objectKeys = items.flatMap((item) => {
          // Handoff owns no temporary copies: abandoned plans leave all source bytes intact.
          if (item.storageAction === 'HANDOFF') return [];
          if (item.storageAction !== undefined) throw new Error('Invalid transfer storage action');
          if (item.pyramid) {
            const prefix = item.pyramid.targetPrefix;
            assertOwnedObjectKey(plan.ownerId, prefix);
            if (
              !prefix.startsWith(`users/${plan.ownerId}/assets/${item.targetId}/`) ||
              !prefix.endsWith('/')
            )
              throw new Error('Invalid transfer cleanup prefix');
            prefixes.push(prefix);
          }
          const keys = [item.targetKey, ...(item.renditions ?? []).map((r) => r.targetKey)];
          if (keys.length > 17) throw new Error('Invalid transfer cleanup plan');
          for (const key of keys) {
            assertOwnedObjectKey(plan.ownerId, key);
            if (!key.startsWith(`users/${plan.ownerId}/assets/${item.targetId}/`))
              throw new Error('Invalid transfer cleanup key');
          }
          return keys;
        });
        await tx.eagleLibraryTransfer.update({
          where: { id: plan.id, ownerId: plan.ownerId, sourceMode: plan.sourceMode },
          data: { status: 'ABANDONED', updatedAt: now },
        });
        if (objectKeys.length || prefixes.length)
          await tx.eagleObjectDeletion.create({
            data: { ownerId: plan.ownerId, libraryMode: plan.targetMode, objectKeys, prefixes },
          });
      }
      // Keep tombstones and revisit them daily: a delayed object copy may finish after deletion.
      return plans.length;
    });
  }

  private async runScheduledMaintenance(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.runMaintenance();
      if (result.completedJobsDeleted || result.importRunsDeleted || result.transfersExpired) {
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
