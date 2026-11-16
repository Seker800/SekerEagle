import { EagleImportItemStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../../prisma/prisma.service';
import {
  applyProjectedTerminalItems,
  assertImportRun,
  countGroupedItemStatuses,
} from './import-repository-support';

export class ImportProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(ownerId: string, runId: string) {
    const [run, groups, [diagnostics]] = await Promise.all([
      assertImportRun(this.prisma, ownerId, runId),
      this.prisma.eagleImportRunItem.groupBy({
        by: ['status'],
        where: { ownerId, runId, libraryMode: 'MATERIAL' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        Array<{
          staleMappings: bigint;
          orphanedActiveSessions: bigint;
          expiredActiveSessions: bigint;
          completedSessionsPendingConvergence: bigint;
          contentHashMismatches: bigint;
        }>
      >(
        Prisma.sql`
          SELECT
            COUNT(*) FILTER (
              WHERE item."status" = 'IMPORTED'
                AND (item."assetId" IS NULL OR external."assetId" IS DISTINCT FROM item."assetId")
            )::bigint AS "staleMappings",
            COUNT(*) FILTER (
              WHERE item."activeUploadSessionId" IS NOT NULL AND session."id" IS NULL
            )::bigint AS "orphanedActiveSessions",
            COUNT(*) FILTER (
              WHERE item."activeUploadSessionId" IS NOT NULL
                AND session."status" = 'INITIATED'
                AND session."createdAt" < NOW() - INTERVAL '24 hours'
            )::bigint AS "expiredActiveSessions",
            COUNT(*) FILTER (
              WHERE item."status" <> 'IMPORTED' AND session."status" = 'COMPLETED'
            )::bigint AS "completedSessionsPendingConvergence",
            COUNT(*) FILTER (
              WHERE item."status" = 'IMPORTED'
                AND item."contentSha256" IS NOT NULL
                AND external."sourceContentSha256" IS DISTINCT FROM item."contentSha256"
            )::bigint AS "contentHashMismatches"
          FROM "EagleImportRunItem" item
          JOIN "EagleExternalAsset" external ON external."id" = item."externalAssetId"
          LEFT JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
          WHERE item."ownerId" = ${ownerId} AND item."libraryMode" = 'MATERIAL'::"LibraryMode" AND item."runId" = ${runId}
        `,
      ),
    ]);
    if (!diagnostics) throw new Error('Eagle 导入对账聚合未返回结果。');
    const staleMappings = Number(diagnostics.staleMappings);
    const orphanedActiveSessions = Number(diagnostics.orphanedActiveSessions);
    const expiredActiveSessions = Number(diagnostics.expiredActiveSessions);
    const completedSessionsPendingConvergence = Number(
      diagnostics.completedSessionsPendingConvergence,
    );
    const contentHashMismatches = Number(diagnostics.contentHashMismatches);
    const actual = countGroupedItemStatuses(groups);
    return {
      runId,
      consistent:
        staleMappings === 0 &&
        orphanedActiveSessions === 0 &&
        expiredActiveSessions === 0 &&
        completedSessionsPendingConvergence === 0 &&
        contentHashMismatches === 0 &&
        run.stagedItemCount === actual.stagedItemCount &&
        run.importedItemCount === actual.importedItemCount &&
        run.skippedItemCount === actual.skippedItemCount &&
        run.failedItemCount === actual.failedItemCount,
      staleMappings,
      orphanedActiveSessions,
      expiredActiveSessions,
      completedSessionsPendingConvergence,
      contentHashMismatches,
      recorded: {
        stagedItemCount: run.stagedItemCount,
        importedItemCount: run.importedItemCount,
        skippedItemCount: run.skippedItemCount,
        failedItemCount: run.failedItemCount,
      },
      actual,
    };
  }

  async backfillTerminalProgress(
    limit: number,
  ): Promise<{ runsReconciled: number; itemsMarked: number }> {
    const safeLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
    return this.prisma.$transaction(async (transaction) => {
      const [run] = await transaction.$queryRaw<Array<{ id: string; ownerId: string }>>(
        Prisma.sql`
          SELECT run."id", run."ownerId"
          FROM "EagleImportRun" run
          WHERE EXISTS (
            SELECT 1
            FROM "EagleImportRunItem" item
            WHERE item."runId" = run."id"
              AND item."terminalProgressAppliedAt" IS NULL
              AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
          )
          ORDER BY run."updatedAt" ASC, run."id" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `,
      );
      if (!run) return { runsReconciled: 0, itemsMarked: 0 };

      const groups = await transaction.eagleImportRunItem.groupBy({
        by: ['status'],
        where: { ownerId: run.ownerId, runId: run.id, libraryMode: 'MATERIAL' },
        _count: { _all: true },
      });
      await transaction.eagleImportRun.update({
        where: { id: run.id, libraryMode: 'MATERIAL' },
        data: countGroupedItemStatuses(groups),
      });

      const candidates = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT item."id"
        FROM "EagleImportRunItem" item
        WHERE item."ownerId" = ${run.ownerId}
          AND item."runId" = ${run.id}
          AND item."terminalProgressAppliedAt" IS NULL
          AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
        ORDER BY item."updatedAt" ASC, item."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      `);
      if (!candidates.length) return { runsReconciled: 1, itemsMarked: 0 };

      const marked = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: { in: candidates.map(({ id }) => id) },
          terminalProgressAppliedAt: null,
          libraryMode: 'MATERIAL',
        },
        data: { terminalProgressAppliedAt: new Date() },
      });
      if (marked.count !== candidates.length) {
        throw new Error('Eagle 导入进度兼容回填标记不完整。');
      }
      return { runsReconciled: 1, itemsMarked: marked.count };
    });
  }

  async projectTerminalItemProgress(limit: number): Promise<number> {
    const safeLimit = Math.min(1_000, Math.max(1, Math.trunc(limit)));
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<
        Array<{
          id: string;
          ownerId: string;
          runId: string;
          status: EagleImportItemStatus;
        }>
      >(Prisma.sql`
        SELECT item."id", item."ownerId", item."runId", item."status"
        FROM "EagleImportRunItem" item
        WHERE item."terminalProgressAppliedAt" IS NULL
          AND item."status" IN ('IMPORTED', 'SKIPPED', 'FAILED')
        ORDER BY item."runId" ASC, item."updatedAt" ASC, item."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      `);
      if (!candidates.length) return 0;

      const byRun = new Map<
        string,
        {
          ownerId: string;
          runId: string;
          itemIds: string[];
          importedItemCount: number;
          skippedItemCount: number;
          failedItemCount: number;
        }
      >();
      for (const candidate of candidates) {
        const key = `${candidate.ownerId}:${candidate.runId}`;
        const group = byRun.get(key) ?? {
          ownerId: candidate.ownerId,
          runId: candidate.runId,
          itemIds: [],
          importedItemCount: 0,
          skippedItemCount: 0,
          failedItemCount: 0,
        };
        group.itemIds.push(candidate.id);
        if (candidate.status === EagleImportItemStatus.IMPORTED) group.importedItemCount += 1;
        if (candidate.status === EagleImportItemStatus.SKIPPED) group.skippedItemCount += 1;
        if (candidate.status === EagleImportItemStatus.FAILED) group.failedItemCount += 1;
        byRun.set(key, group);
      }

      const projectedAt = new Date();
      for (const group of byRun.values()) {
        await applyProjectedTerminalItems(transaction, group, projectedAt);
      }
      return candidates.length;
    });
  }

  async pruneTerminalRuns(input: {
    retentionDays: number;
    keepPerLibrary: number;
    limit: number;
  }): Promise<number> {
    const cutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1_000);
    const deleted = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH ranked AS (
        SELECT
          run."id",
          run."completedAt",
          run."cancelledAt",
          run."updatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY run."ownerId", run."externalLibraryId"
            ORDER BY run."createdAt" DESC, run."id" DESC
          ) AS position
        FROM "EagleImportRun" run
        WHERE run."status" IN ('COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED')
      ), candidates AS (
        SELECT ranked."id"
        FROM ranked
        WHERE ranked.position > ${input.keepPerLibrary}
          AND COALESCE(ranked."completedAt", ranked."cancelledAt", ranked."updatedAt") < ${cutoff}
        ORDER BY COALESCE(ranked."completedAt", ranked."cancelledAt", ranked."updatedAt") ASC
        LIMIT ${input.limit}
      )
      DELETE FROM "EagleImportRun" run
      USING candidates
      WHERE run."id" = candidates."id"
      RETURNING run."id"
    `);
    return deleted.length;
  }
}
