import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import {
  assetOperationState,
  type AssetMembershipFact,
  type AssetOperationKind,
  type AssetOperationResults,
  type AssetOperationSummary,
} from '@sekereagle/library-core';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { databaseBatches, databaseBatchSize, DATABASE_STATEMENTS } from './eagle-database-batches';
import { LIBRARY_MODE } from './library-mode';
import type { OperationWithItems } from './library-operation-types';

const ADMISSION_BATCH_SIZE = databaseBatchSize(DATABASE_STATEMENTS.operationItems);

@Injectable()
export class LibraryOperationQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LIBRARY_MODE) readonly libraryMode: LibraryMode,
  ) {}

  libraryModeWhere(ownerId: string, includePrivate: boolean) {
    return {
      ownerId,
      libraryMode: this.libraryMode,
      ...(includePrivate ? {} : { isPrivate: false }),
    };
  }
  summary(
    operation: OperationWithItems,
    errors?: Array<{ code: string; count: number }>,
  ): AssetOperationSummary {
    const items = operation.items;
    const count = (status: string) =>
      (items ?? [])
        .filter((item) => item.status === status)
        .reduce((sum, item) => sum + item.weight, 0);
    const counts = items
      ? {
          queued: count('PENDING'),
          running: count('RUNNING'),
          completed: count('COMPLETED') + count('SKIPPED'),
          failed: count('FAILED'),
          cancelled: count('CANCELLED'),
        }
      : {
          queued: operation.queuedWeight,
          running: operation.runningWeight,
          completed: operation.completedWeight + operation.skippedWeight,
          failed: operation.failedWeight,
          cancelled: operation.cancelledWeight,
        };
    const skipped = items ? count('SKIPPED') : operation.skippedWeight;
    const total = items
      ? items.reduce((n, item) => n + item.weight, 0)
      : counts.queued + counts.running + counts.completed + counts.failed + counts.cancelled;
    const errorList =
      errors ??
      (() => {
        if (items) {
          const errorMap = new Map<string, number>();
          for (const item of items)
            if (item.status === 'FAILED' && item.errorCode)
              errorMap.set(item.errorCode, (errorMap.get(item.errorCode) ?? 0) + item.weight);
          return [...errorMap].map(([code, count]) => ({ code, count }));
        }
        const stored = operation.errorCounts;
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
        return Object.entries(stored)
          .flatMap(([code, count]) =>
            typeof count === 'number' && count > 0 ? [{ code, count }] : [],
          )
          .sort((left, right) => left.code.localeCompare(right.code));
      })();
    return {
      ...(['METADATA_COMMAND', 'BACKGROUND_COMMAND'].includes(operation.kind) &&
      operation.inputIds?.[1]
        ? { commandType: operation.inputIds[1] }
        : {}),
      ...(operation.privacyChanged ? { privacyChanged: true } : {}),
      ...(operation.undoOfId ? { undoOf: operation.undoOfId } : {}),
      id: operation.id,
      kind: operation.kind as AssetOperationKind,
      libraryMode: operation.libraryMode,
      total,
      ...counts,
      ...(skipped ? { skipped } : {}),
      state: assetOperationState(counts),
      errors: errorList,
    };
  }

  async list(ownerId: string, includePrivate = false) {
    const select = {
      id: true,
      ownerId: true,
      kind: true,
      libraryMode: true,
      undoOfId: true,
      inputIds: true,
      privacyChanged: true,
      queuedWeight: true,
      runningWeight: true,
      completedWeight: true,
      skippedWeight: true,
      failedWeight: true,
      cancelledWeight: true,
      errorCounts: true,
    } as const;
    const [active, recent] = await Promise.all([
      this.prisma.eagleAssetOperation.findMany({
        where: {
          ...this.libraryModeWhere(ownerId, includePrivate),
          items: { some: { status: { in: ['PENDING', 'RUNNING'] } } },
        },
        select,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.eagleAssetOperation.findMany({
        where: this.libraryModeWhere(ownerId, includePrivate),
        select,
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);
    // Recent history must never push a still-running operation out of the visible window.
    const operations = [...new Map([...active, ...recent].map((row) => [row.id, row])).values()];
    return operations.map((operation) => this.summary(operation as OperationWithItems));
  }

  async results(
    principal: AuthPrincipal,
    id: string,
    query: { cursor?: number; revision?: string },
  ): Promise<AssetOperationResults> {
    const operation = await this.prisma.eagleAssetOperation.findFirst({
      where: { id, ...this.libraryModeWhere(principal.sub, principal.canViewPrivate) },
      select: {
        id: true,
        ownerId: true,
        kind: true,
        libraryMode: true,
        undoOfId: true,
        updatedAt: true,
        inputIds: true,
        privacyChanged: true,
        queuedWeight: true,
        runningWeight: true,
        completedWeight: true,
        skippedWeight: true,
        failedWeight: true,
        cancelledWeight: true,
        errorCounts: true,
      },
    });
    if (!operation) throw new NotFoundException('操作不存在。');
    const scope = { operationId: id, ownerId: principal.sub, libraryMode: this.libraryMode };
    const operationSummary = this.summary(operation);
    const revision = JSON.stringify([operation.updatedAt.toISOString(), operationSummary]);
    if (query.revision && query.revision !== revision)
      throw new ConflictException('操作结果已变化，请重新读取。');
    if (operationSummary.running || operationSummary.queued)
      return {
        operation: operationSummary,
        revision,
        receipts: [],
        membership: [],
        nextCursor: null,
      };
    const rows = await this.prisma.eagleAssetOperationItem.findMany({
      where: {
        ...scope,
        libraryMode: this.libraryMode,
        weight: { gt: 0 },
        ordinal: { gte: query.cursor ?? 0 },
      },
      select: { ordinal: true, assetIds: true, snapshots: true, status: true, errorCode: true },
      orderBy: { ordinal: 'asc' },
      take: ADMISSION_BATCH_SIZE + 1,
    });
    const page = rows.slice(0, ADMISSION_BATCH_SIZE);
    const resourceIds = [
      ...new Set(page.flatMap((row) => this.receiptIds(row.assetIds, row.snapshots))),
    ];
    const membership: AssetMembershipFact[] = [];
    for (const { rows: ids } of databaseBatches(
      resourceIds,
      DATABASE_STATEMENTS.operationMembership,
    )) {
      membership.push(
        ...(await this.prisma.$queryRaw<AssetMembershipFact[]>`
        SELECT requested.id, a."rowVersion",
          CASE WHEN a.id IS NULL OR a."storageTransferredOut" OR a."purgeAfter" IS NOT NULL THEN 'UNAVAILABLE'
               WHEN a."deletedAt" IS NOT NULL THEN 'TRASH' ELSE 'ACTIVE' END AS state
        FROM unnest(${ids}::text[]) AS requested(id)
        LEFT JOIN "EagleAsset" a ON a.id=requested.id AND a."ownerId"=${principal.sub}
          AND a."libraryMode"=${this.libraryMode}::"LibraryMode"
          AND (${principal.canViewPrivate} OR NOT a."isPrivate")
      `),
      );
    }
    return {
      operation: operationSummary,
      revision,
      membership,
      receipts: page.map((row) => ({
        ...(row.snapshots &&
        !Array.isArray(row.snapshots) &&
        typeof row.snapshots === 'object' &&
        typeof row.snapshots.signature === 'string'
          ? { groupSignature: row.snapshots.signature }
          : {}),
        status: row.status,
        errorCode: row.errorCode,
        assetIds: this.receiptIds(row.assetIds, row.snapshots),
      })),
      nextCursor: rows.length > ADMISSION_BATCH_SIZE ? rows[ADMISSION_BATCH_SIZE]!.ordinal : null,
    };
  }
  private receiptIds(assetIds: string[], snapshots: Prisma.JsonValue) {
    const resources = Array.isArray(snapshots)
      ? snapshots
      : snapshots && typeof snapshots === 'object' && 'resources' in snapshots
        ? snapshots.resources
        : [];
    return [
      ...new Set([
        ...assetIds,
        ...(Array.isArray(resources)
          ? resources.flatMap((row) =>
              row && typeof row === 'object' && 'id' in row && typeof row.id === 'string'
                ? [row.id]
                : [],
            )
          : []),
      ]),
    ];
  }
  async owned(tx: Prisma.TransactionClient, id: string, ownerId: string, includePrivate: boolean) {
    const operation = await tx.eagleAssetOperation.findFirst({
      where: { id, ...this.libraryModeWhere(ownerId, includePrivate) },
      select: {
        id: true,
        ownerId: true,
        libraryMode: true,
        kind: true,
        authVersion: true,
        isPrivate: true,
        privateUntil: true,
        undoOfId: true,
        inputIds: true,
        privacyChanged: true,
        queuedWeight: true,
        runningWeight: true,
        completedWeight: true,
        skippedWeight: true,
        failedWeight: true,
        cancelledWeight: true,
        errorCounts: true,
      },
    });
    if (!operation) throw new NotFoundException('操作不存在。');
    return operation;
  }
}
