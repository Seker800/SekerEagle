import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  EagleImportItemAction,
  EagleImportItemStatus,
  EagleImportRunStatus,
  Prisma,
  UploadSessionStatus,
} from '@prisma/client';
import { UPLOAD_PART_SIZE_BYTES } from '../../upload-limits';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { SekerEagleIngestionPort } from '../../../seker-eagle-ingestion.port';
import {
  canFinalizeEagleImportUpload,
  canRunAcceptEagleImportUpload,
  canStartEagleImportUpload,
  isTerminalEagleImportItem,
} from '../../eagle-app-import-policy';
import {
  IMPORT_ITEM_SELECT,
  type ImportItemProjection,
  applyImportMetadata,
  applyTerminalItemDelta,
  assertImportRun,
  decodeItemCursor,
  encodeItemCursor,
  isContentHashMismatch,
  lockImportItem,
  lockImportRun,
} from './import-repository-support';

export class ImportItemRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  ) {}

  async getUploadItem(ownerId: string, runId: string, itemId: string) {
    return this.prisma.eagleImportRunItem.findFirst({
      where: {
        ownerId,
        runId,
        id: itemId,
        status: 'STAGED',
        action: { in: ['NEW', 'CONTENT_REPLACE'] },
        libraryMode: 'MATERIAL',
      },
      select: {
        originalFileName: true,
        mimeType: true,
        byteSize: true,
        contentSha256: true,
      },
    });
  }

  async listItems(
    ownerId: string,
    runId: string,
    input: { limit?: number; cursor?: string; status?: EagleImportItemStatus },
  ) {
    await assertImportRun(this.prisma, ownerId, runId);
    const limit = Math.min(100, Math.max(1, input.limit ?? 50));
    const cursorId = input.cursor ? decodeItemCursor(input.cursor) : null;
    const rows = await this.prisma.eagleImportRunItem.findMany({
      where: {
        ownerId,
        runId,
        ...(input.status ? { status: input.status } : {}),
        ...(cursorId ? { id: { gt: cursorId } } : {}),
        libraryMode: 'MATERIAL',
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: IMPORT_ITEM_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const activeSessionIds = page
      .map((item) => item.activeUploadSessionId)
      .filter((id): id is string => Boolean(id));
    const sessions = activeSessionIds.length
      ? await this.prisma.uploadSession.findMany({
          where: { uploaderId: ownerId, id: { in: activeSessionIds }, libraryMode: 'MATERIAL' },
          select: { id: true, status: true, createdAt: true, updatedAt: true },
        })
      : [];
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    return {
      items: page.map((item) =>
        this.serializeItem(item, sessionsById.get(item.activeUploadSessionId ?? '')),
      ),
      nextCursor: hasMore && page.length ? encodeItemCursor(page.at(-1)!.id) : null,
    };
  }

  async retryItem(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      await lockImportItem(transaction, ownerId, runId, itemId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, runId, ownerId, libraryMode: 'MATERIAL' },
        select: {
          id: true,
          runId: true,
          status: true,
          activeUploadSessionId: true,
          action: true,
          assetId: true,
          contentSha256: true,
          terminalProgressAppliedAt: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (item.run.status === EagleImportRunStatus.CANCELLED) {
        throw new ConflictException('已取消的 Eagle 导入任务不能重试。');
      }
      if (item.status !== EagleImportItemStatus.FAILED) {
        throw new ConflictException('只有失败的 Eagle 导入项可以重试。');
      }
      if (item.activeUploadSessionId) {
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: item.activeUploadSessionId, ownerId, libraryMode: 'MATERIAL' },
          data: { supersededAt: new Date() },
        });
      }
      const updated = await transaction.eagleImportRunItem.update({
        where: { id: itemId, libraryMode: 'MATERIAL' },
        data: {
          status: EagleImportItemStatus.STAGED,
          activeUploadSessionId: null,
          errorCode: null,
          errorMessage: null,
          terminalProgressAppliedAt: null,
          completedAt: null,
        },
        select: IMPORT_ITEM_SELECT,
      });
      await transaction.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: {
          stagedItemCount: { increment: 1 },
          ...(item.terminalProgressAppliedAt ? { failedItemCount: { decrement: 1 } } : {}),
          status: EagleImportRunStatus.RUNNING,
          completedAt: null,
        },
      });
      return this.serializeItem(updated);
    });
  }

  async resetUpload(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportRun(transaction, ownerId, runId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, runId, ownerId, libraryMode: 'MATERIAL' },
        select: {
          id: true,
          status: true,
          activeUploadSessionId: true,
          terminalProgressAppliedAt: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (item.run.status === EagleImportRunStatus.CANCELLED) {
        throw new ConflictException('已取消的 Eagle 导入任务不能重置上传。');
      }
      const session = item.activeUploadSessionId
        ? await transaction.uploadSession.findFirst({
            where: { id: item.activeUploadSessionId, uploaderId: ownerId, libraryMode: 'MATERIAL' },
            select: { status: true, createdAt: true },
          })
        : null;
      const expired = Boolean(
        session &&
        session.status === UploadSessionStatus.INITIATED &&
        session.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1_000,
      );
      const resettableSession =
        !session ||
        expired ||
        session.status === UploadSessionStatus.ABORTED ||
        session.status === UploadSessionStatus.FAILED;
      if (
        item.status !== EagleImportItemStatus.FAILED &&
        !(item.status === EagleImportItemStatus.UPLOADING && resettableSession)
      ) {
        throw new ConflictException('正常上传或正在完成的 Eagle 导入项不能重置。');
      }
      if (item.activeUploadSessionId) {
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: item.activeUploadSessionId, ownerId, libraryMode: 'MATERIAL' },
          data: { supersededAt: new Date() },
        });
      }
      const updated = await transaction.eagleImportRunItem.update({
        where: { id: item.id, libraryMode: 'MATERIAL' },
        data: {
          status: EagleImportItemStatus.STAGED,
          activeUploadSessionId: null,
          errorCode: null,
          errorMessage: null,
          terminalProgressAppliedAt: null,
          completedAt: null,
        },
        select: IMPORT_ITEM_SELECT,
      });
      await transaction.eagleImportRun.update({
        where: { id: runId, libraryMode: 'MATERIAL' },
        data: {
          stagedItemCount: { increment: 1 },
          ...(item.status === EagleImportItemStatus.FAILED && item.terminalProgressAppliedAt
            ? { failedItemCount: { decrement: 1 } }
            : {}),
          status: EagleImportRunStatus.RUNNING,
          completedAt: null,
        },
      });
      return this.serializeItem(updated);
    });
  }

  async prepareUploadStart(ownerId: string, runId: string, itemId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await lockImportItem(transaction, ownerId, runId, itemId);
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { id: itemId, ownerId, runId, libraryMode: 'MATERIAL' },
        select: {
          status: true,
          action: true,
          contentSha256: true,
          assetId: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (!canRunAcceptEagleImportUpload(item.run.status)) {
        throw new ConflictException('Eagle 导入任务必须先通过预检。');
      }
      if (item.status === EagleImportItemStatus.IMPORTED) {
        return { kind: 'IMPORTED' as const, assetId: item.assetId };
      }
      if (item.status === EagleImportItemStatus.FINALIZING) {
        return {
          kind: 'FINALIZING' as const,
          sessionId: item.activeUploadSessionId,
        };
      }
      if (item.status === EagleImportItemStatus.UPLOADING && item.activeUploadSessionId) {
        const session = await transaction.uploadSession.findFirst({
          where: { id: item.activeUploadSessionId, uploaderId: ownerId, libraryMode: 'MATERIAL' },
          select: { status: true, createdAt: true, finalizationAttempts: true },
        });
        const expired = Boolean(
          session &&
          session.status === UploadSessionStatus.INITIATED &&
          session.createdAt.getTime() < Date.now() - 24 * 60 * 60 * 1_000,
        );
        const replaceable =
          !session ||
          expired ||
          session.status === UploadSessionStatus.ABORTED ||
          (session.status === UploadSessionStatus.FAILED && session.finalizationAttempts >= 10);
        if (!replaceable) {
          return { kind: 'RESUME' as const, sessionId: item.activeUploadSessionId };
        }
        const replacedSessionId = item.activeUploadSessionId;
        await transaction.eagleUploadSessionState.updateMany({
          where: { uploadSessionId: replacedSessionId, ownerId, libraryMode: 'MATERIAL' },
          data: { supersededAt: new Date() },
        });
        await transaction.eagleImportRunItem.update({
          where: { id: itemId, libraryMode: 'MATERIAL' },
          data: { status: EagleImportItemStatus.STAGED, activeUploadSessionId: null },
        });
        await transaction.eagleImportRun.update({
          where: { id: runId, libraryMode: 'MATERIAL' },
          data: { stagedItemCount: { increment: 1 } },
        });
        return {
          kind: 'CREATE' as const,
          replacedSessionId,
          action: item.action,
          assetId: item.assetId,
          contentSha256: item.contentSha256,
        };
      }
      if (item.status !== EagleImportItemStatus.STAGED) {
        throw new ConflictException('当前 Eagle 导入项不能开始上传。');
      }
      return {
        kind: 'CREATE' as const,
        replacedSessionId: null,
        action: item.action,
        assetId: item.assetId,
        contentSha256: item.contentSha256,
      };
    });
  }

  async bindUploadSession(input: {
    ownerId: string;
    runId: string;
    runItemId: string;
    uploadSessionId: string;
    fileName: string;
    mimeType: string;
    size: bigint;
  }): Promise<{ accepted: boolean; activeUploadSessionId: string }> {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: {
          id: input.runItemId,
          ownerId: input.ownerId,
          runId: input.runId,
          libraryMode: 'MATERIAL',
        },
        select: {
          id: true,
          runId: true,
          originalFileName: true,
          mimeType: true,
          byteSize: true,
          status: true,
          activeUploadSessionId: true,
          action: true,
          assetId: true,
          contentSha256: true,
          run: { select: { status: true, startedAt: true } },
        },
      });
      if (!item) throw new NotFoundException('Eagle 导入项不存在。');
      if (!canRunAcceptEagleImportUpload(item.run.status)) {
        throw new ConflictException('Eagle 导入任务必须先通过预检。');
      }
      if (
        item.originalFileName !== input.fileName ||
        item.mimeType !== input.mimeType ||
        item.byteSize !== input.size
      ) {
        throw new BadRequestException('上传文件与 Eagle 清单声明不一致。');
      }
      if (item.status === EagleImportItemStatus.UPLOADING && item.activeUploadSessionId) {
        return { accepted: false, activeUploadSessionId: item.activeUploadSessionId };
      }
      if (!canStartEagleImportUpload(item.run.status, item.status)) {
        throw new ConflictException('当前 Eagle 导入项不能开始上传。');
      }
      const claimed = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: item.id,
          ownerId: input.ownerId,
          status: EagleImportItemStatus.STAGED,
          libraryMode: 'MATERIAL',
        },
        data: {
          status: EagleImportItemStatus.UPLOADING,
          activeUploadSessionId: input.uploadSessionId,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        const winner = await transaction.eagleImportRunItem.findFirst({
          where: { id: item.id, ownerId: input.ownerId, libraryMode: 'MATERIAL' },
          select: { activeUploadSessionId: true },
        });
        if (winner?.activeUploadSessionId) {
          return { accepted: false, activeUploadSessionId: winner.activeUploadSessionId };
        }
        throw new ConflictException('Eagle 导入项已被其他上传占用。');
      }
      await transaction.eagleUploadSessionState.update({
        where: { uploadSessionId: input.uploadSessionId, libraryMode: 'MATERIAL' },
        data: {
          duplicatePolicy: 'CREATE_COPY',
          replacementAssetId:
            item.action === EagleImportItemAction.CONTENT_REPLACE ? item.assetId : null,
          expectedContentSha256: item.contentSha256,
        },
      });
      await transaction.eagleImportRun.update({
        where: { id: item.runId, libraryMode: 'MATERIAL' },
        data: {
          stagedItemCount: { decrement: 1 },
          status: EagleImportRunStatus.RUNNING,
          startedAt: item.run.startedAt ?? new Date(),
        },
      });
      return { accepted: true, activeUploadSessionId: input.uploadSessionId };
    });
  }

  async finalizeUpload(ownerId: string, uploadSessionId: string, assetId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { ownerId, activeUploadSessionId: uploadSessionId, libraryMode: 'MATERIAL' },
        select: {
          id: true,
          runId: true,
          externalAssetId: true,
          displayName: true,
          sourceImportedAt: true,
          sourceModifiedAt: true,
          metadataHash: true,
          contentSha256: true,
          sourceFileModifiedAt: true,
          byteSize: true,
          rating: true,
          description: true,
          sourceUrl: true,
          tagNames: true,
          assetId: true,
          status: true,
          action: true,
          attemptCount: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) return null;
      if (item.status === EagleImportItemStatus.IMPORTED && item.assetId === assetId) {
        return {
          runId: item.runId,
          runItemId: item.id,
          action: item.action,
          attemptCount: item.attemptCount,
          byteSize: Number(item.byteSize),
        };
      }
      if (!canFinalizeEagleImportUpload(item.status)) {
        throw new ConflictException('当前 Eagle 导入项不能完成导入。');
      }
      if (item.status === EagleImportItemStatus.UPLOADING) {
        const claimed = await transaction.eagleImportRunItem.updateMany({
          where: {
            id: item.id,
            ownerId,
            status: EagleImportItemStatus.UPLOADING,
            activeUploadSessionId: uploadSessionId,
            libraryMode: 'MATERIAL',
          },
          data: { status: EagleImportItemStatus.FINALIZING },
        });
        if (claimed.count !== 1) throw new ConflictException('Eagle 导入项正在由其他请求完成。');
      }

      await applyImportMetadata(this.ingestion, transaction, ownerId, item, assetId);
      const completedAt = new Date();
      await transaction.eagleExternalAsset.update({
        where: { id: item.externalAssetId, libraryMode: 'MATERIAL' },
        data: {
          assetId,
          sourceImportedAt: item.sourceImportedAt,
          sourceModifiedAt: item.sourceModifiedAt,
          metadataHash: item.metadataHash,
          sourceContentSha256: item.contentSha256 ?? undefined,
          sourceFileModifiedAt: item.sourceFileModifiedAt ?? undefined,
          sourceByteSize: item.byteSize,
          lastSeenAt: completedAt,
          lastImportedAt: completedAt,
        },
      });
      await transaction.eagleImportRunItem.update({
        where: { id: item.id, libraryMode: 'MATERIAL' },
        data: {
          assetId,
          status: EagleImportItemStatus.IMPORTED,
          errorCode: null,
          errorMessage: null,
          completedAt,
        },
      });
      await applyTerminalItemDelta(
        transaction,
        ownerId,
        item.runId,
        [item.id],
        { importedItemCount: 1 },
        completedAt,
      );
      return {
        runId: item.runId,
        runItemId: item.id,
        action: item.action,
        attemptCount: item.attemptCount,
        byteSize: Number(item.byteSize),
      };
    });
  }

  async markUploadFailed(
    ownerId: string,
    uploadSessionId: string,
    error: unknown,
    context: { terminal: boolean; permanent: boolean },
  ) {
    await this.prisma.$transaction(async (transaction) => {
      const item = await transaction.eagleImportRunItem.findFirst({
        where: { ownerId, activeUploadSessionId: uploadSessionId, libraryMode: 'MATERIAL' },
        select: {
          id: true,
          runId: true,
          status: true,
          activeUploadSessionId: true,
          run: { select: { status: true } },
        },
      });
      if (
        !item ||
        item.activeUploadSessionId !== uploadSessionId ||
        isTerminalEagleImportItem(item.status)
      )
        return;
      const updated = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: item.id,
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: { in: [EagleImportItemStatus.UPLOADING, EagleImportItemStatus.FINALIZING] },
          libraryMode: 'MATERIAL',
        },
        data: {
          ...(context.terminal
            ? {
                status: EagleImportItemStatus.FAILED,
                completedAt: new Date(),
              }
            : {}),
          errorCode: isContentHashMismatch(error)
            ? 'CONTENT_HASH_MISMATCH'
            : context.permanent || error instanceof BadRequestException
              ? 'INVALID_MEDIA'
              : 'UPLOAD_FINALIZATION_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'Unknown',
        },
      });
      if (updated.count !== 1) return;
      const completedAt = new Date();
      if (!context.terminal) {
        await transaction.eagleImportRun.update({
          where: { id: item.runId, libraryMode: 'MATERIAL' },
          data: { lastErrorCode: 'ITEM_FAILED' },
        });
      } else {
        await applyTerminalItemDelta(
          transaction,
          ownerId,
          item.runId,
          [item.id],
          { failedItemCount: 1 },
          completedAt,
          'ITEM_FAILED',
        );
      }
    });
  }

  async expireUploadSession(
    ownerId: string,
    uploadSessionId: string,
    expiredAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const expired = await transaction.uploadSession.updateMany({
        where: {
          id: uploadSessionId,
          uploaderId: ownerId,
          status: UploadSessionStatus.INITIATED,
          libraryMode: 'MATERIAL',
        },
        data: {
          status: UploadSessionStatus.ABORTED,
          abortedAt: expiredAt,
        },
      });
      if (expired.count !== 1) return false;

      const item = await transaction.eagleImportRunItem.findFirst({
        where: {
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: EagleImportItemStatus.UPLOADING,
          libraryMode: 'MATERIAL',
        },
        select: {
          id: true,
          runId: true,
          run: { select: { status: true } },
        },
      });
      if (!item) return true;

      const converged = await transaction.eagleImportRunItem.updateMany({
        where: {
          id: item.id,
          ownerId,
          activeUploadSessionId: uploadSessionId,
          status: EagleImportItemStatus.UPLOADING,
          libraryMode: 'MATERIAL',
        },
        data: {
          status: EagleImportItemStatus.FAILED,
          activeUploadSessionId: null,
          errorCode: 'UPLOAD_SESSION_EXPIRED',
          errorMessage: '上传会话已过期或不可恢复。',
          completedAt: expiredAt,
        },
      });
      if (converged.count !== 1) return true;

      await transaction.eagleUploadSessionState.updateMany({
        where: { ownerId, uploadSessionId, libraryMode: 'MATERIAL' },
        data: { supersededAt: expiredAt },
      });
      await applyTerminalItemDelta(
        transaction,
        ownerId,
        item.runId,
        [item.id],
        { failedItemCount: 1 },
        expiredAt,
        'UPLOAD_SESSION_EXPIRED',
      );
      return true;
    });
  }

  async reconcileStaleUploadSessions(): Promise<number> {
    const completedSessions = await this.prisma.$queryRaw<
      Array<{ ownerId: string; uploadSessionId: string; assetId: string }>
    >(Prisma.sql`
      SELECT
        item."ownerId",
        item."activeUploadSessionId" AS "uploadSessionId",
        state."assetId"
      FROM "EagleImportRunItem" item
      JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
      JOIN "EagleUploadSessionState" state ON state."uploadSessionId" = session."id"
      WHERE item."status" IN ('UPLOADING', 'FINALIZING')
        AND session."status" = 'COMPLETED'
        AND state."assetId" IS NOT NULL
      ORDER BY item."updatedAt" ASC
      LIMIT 500
    `);
    let completedConverged = 0;
    for (const session of completedSessions) {
      try {
        await this.finalizeUpload(session.ownerId, session.uploadSessionId, session.assetId);
        completedConverged += 1;
      } catch {
        // A later reconciler pass retries; the completed upload and object remain durable.
      }
    }

    const staleConverged = await this.prisma.$transaction(async (transaction) => {
      const converged = await transaction.$queryRaw<
        Array<{ id: string; ownerId: string; runId: string; uploadSessionId: string }>
      >(Prisma.sql`
        WITH candidates AS (
          SELECT item."id", item."activeUploadSessionId"
          FROM "EagleImportRunItem" item
          LEFT JOIN "UploadSession" session ON session."id" = item."activeUploadSessionId"
          WHERE item."status" = 'UPLOADING'
            AND item."activeUploadSessionId" IS NOT NULL
            AND (
              session."id" IS NULL
              OR session."status" = 'ABORTED'
              OR (session."status" = 'FAILED' AND session."finalizationAttempts" >= 10)
              OR (
                session."status" = 'INITIATED'
                AND session."createdAt" < NOW() - INTERVAL '24 hours'
              )
            )
          ORDER BY item."updatedAt" ASC
          LIMIT 500
          FOR UPDATE OF item SKIP LOCKED
        )
        UPDATE "EagleImportRunItem" item
        SET
          "status" = 'FAILED',
          "activeUploadSessionId" = NULL,
          "errorCode" = 'UPLOAD_SESSION_EXPIRED',
          "errorMessage" = '上传会话已过期或不可恢复。',
          "completedAt" = NOW(),
          "updatedAt" = NOW()
        FROM candidates
        WHERE item."id" = candidates."id"
        RETURNING
          item."id",
          item."ownerId",
          item."runId",
          candidates."activeUploadSessionId" AS "uploadSessionId"
      `);
      if (converged.length) {
        await transaction.eagleUploadSessionState.updateMany({
          where: {
            uploadSessionId: { in: converged.map((item) => item.uploadSessionId) },
            libraryMode: 'MATERIAL',
          },
          data: { supersededAt: new Date() },
        });
      }
      const runDeltas = new Map<
        string,
        { ownerId: string; runId: string; count: number; itemIds: string[] }
      >();
      for (const item of converged) {
        const key = `${item.ownerId}:${item.runId}`;
        const current = runDeltas.get(key);
        if (current) {
          current.count += 1;
          current.itemIds.push(item.id);
        } else {
          runDeltas.set(key, {
            ownerId: item.ownerId,
            runId: item.runId,
            count: 1,
            itemIds: [item.id],
          });
        }
      }
      for (const { ownerId, runId, count, itemIds } of runDeltas.values()) {
        await applyTerminalItemDelta(
          transaction,
          ownerId,
          runId,
          itemIds,
          { failedItemCount: count },
          new Date(),
          'UPLOAD_SESSION_EXPIRED',
        );
      }
      return converged.length;
    });
    return completedConverged + staleConverged;
  }

  private serializeItem(
    item: ImportItemProjection,
    session?: { id: string; status: UploadSessionStatus; createdAt: Date; updatedAt: Date },
  ) {
    const { activeUploadSessionId: _activeUploadSessionId, ...view } = item;
    void _activeUploadSessionId;
    return {
      ...view,
      byteSize: Number(item.byteSize),
      activeUpload: session
        ? {
            sessionId: session.id,
            status: session.status,
            partSizeBytes: UPLOAD_PART_SIZE_BYTES,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            expiresAt: new Date(session.createdAt.getTime() + 24 * 60 * 60 * 1_000),
          }
        : null,
    };
  }
}
