import { EagleDuplicateService } from './eagle-duplicates.service';
import {
  OPERATION_DB_BATCH_SIZE,
  OPERATION_SEND_CONCURRENCY,
  OPERATION_POLL_MS,
  OPERATION_ADMISSION_TIMEOUT_MS,
  OPERATION_METADATA_BATCH_SIZE,
} from './eagle-operation-settings';
import {
  BadRequestException,
  RequestTimeoutException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  Prisma,
  type EagleAssetOperation,
  type EagleAssetOperationItem,
  type LibraryMode,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  assetOperationState,
  type AssetOperationKind,
  type AssetOperationSummary,
  type AssetOperationResults,
  type AssetMembershipFact,
} from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { EagleService } from './eagle.service';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';
import { resolveEagleTrashTargets, setEagleTrash } from './eagle-trash';
import { lockOwnerPrivacyProjection } from './eagle-privacy.service';
import type { EnqueueAssetOperationDto } from './eagle-asset-operations.dto';

type Snapshot = { id: string; rowVersion: number; mediaRevision: number };
type OperationWithItems = Pick<EagleAssetOperation, 'id' | 'kind' | 'libraryMode'> & {
  undoOfId?: string | null;
  items: Array<Pick<EagleAssetOperationItem, 'status' | 'weight' | 'errorCode'>>;
};
const LEASE_MS = 120_000;
const METADATA_BATCH_SIZE = OPERATION_METADATA_BATCH_SIZE;
const ADMISSION_BATCH_SIZE = OPERATION_DB_BATCH_SIZE;
const SEND_CONCURRENCY = OPERATION_SEND_CONCURRENCY;
// Transfer publication may hold the shared privacy lock for up to 30 seconds.
// Leave a bounded write budget after that wait, inside the 120-second lease.
const METADATA_TRANSACTION_TIMEOUT_MS = 45_000;
type OperationLane = 'SEND' | 'METADATA' | 'SCAN';
const laneKind = (lane: OperationLane) =>
  lane === 'SEND'
    ? 'SEND'
    : lane === 'SCAN'
      ? 'DUPLICATE_SCAN'
      : { notIn: ['SEND', 'DUPLICATE_SCAN'] };
type ClaimedItem = EagleAssetOperationItem & { operation: EagleAssetOperation };
class OperationAccessError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Durable orchestration only: domain writes stay in the existing transfer/trash services. */
@Injectable()
export class EagleAssetOperationService implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly running = new Set<OperationLane>();
  private readonly pendingWake = new Set<OperationLane>();
  private stopping = false;
  private readonly logger = new Logger(EagleAssetOperationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: EagleLibraryTransferService,
    private readonly eagle: EagleService,
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
    @Optional() private readonly duplicates?: EagleDuplicateService,
  ) {}
  get mode() {
    return this.libraryMode;
  }
  startExecutor() {
    if (process.env.EAGLE_ASSET_OPERATIONS_ENABLED === 'false') return;
    this.timer = setInterval(
      () => void this.tick().catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED')),
      OPERATION_POLL_MS,
    );
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  async drain() {
    this.onModuleDestroy();
    while (this.running.size) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  private libraryModeWhere(ownerId: string, includePrivate: boolean) {
    return {
      ownerId,
      libraryMode: this.libraryMode,
      ...(includePrivate ? {} : { isPrivate: false }),
    };
  }
  private summary(operation: OperationWithItems): AssetOperationSummary {
    const count = (status: string) =>
      operation.items
        .filter((item) => item.status === status)
        .reduce((sum, item) => sum + item.weight, 0);
    const counts = {
      queued: count('PENDING'),
      running: count('RUNNING'),
      completed: count('COMPLETED') + count('SKIPPED'),
      failed: count('FAILED'),
      cancelled: count('CANCELLED'),
    };
    const errors = new Map<string, number>();
    for (const item of operation.items)
      if (item.status === 'FAILED' && item.errorCode)
        errors.set(item.errorCode, (errors.get(item.errorCode) ?? 0) + item.weight);
    return {
      ...(operation.undoOfId ? { undoOf: operation.undoOfId } : {}),
      id: operation.id,
      kind: operation.kind as AssetOperationKind,
      libraryMode: operation.libraryMode,
      total: operation.items.reduce((n, item) => n + item.weight, 0),
      ...counts,
      ...(count('SKIPPED') ? { skipped: count('SKIPPED') } : {}),
      state: assetOperationState(counts),
      errors: [...errors].map(([code, count]) => ({ code, count })),
    };
  }
  async list(ownerId: string, includePrivate = false) {
    const select = { id: true, kind: true, libraryMode: true, undoOfId: true } as const;
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
    const counts = await this.prisma.eagleAssetOperationItem.groupBy({
      by: ['operationId', 'status', 'errorCode'],
      where: {
        operationId: { in: operations.map((row) => row.id) },
        ownerId,
        libraryMode: this.libraryMode,
      },
      _sum: { weight: true },
    });
    return operations.map((operation) =>
      this.summary({
        ...operation,
        items: counts
          .filter((row) => row.operationId === operation.id)
          .map((row) => ({
            status: row.status,
            errorCode: row.errorCode,
            weight: row._sum.weight ?? 0,
          })),
      }),
    );
  }

  async results(
    principal: AuthPrincipal,
    id: string,
    query: { cursor?: number; revision?: string },
  ): Promise<AssetOperationResults> {
    const operation = await this.prisma.eagleAssetOperation.findFirst({
      where: { id, ...this.libraryModeWhere(principal.sub, principal.canViewPrivate) },
      select: { id: true, kind: true, libraryMode: true, undoOfId: true, updatedAt: true },
    });
    if (!operation) throw new NotFoundException('操作不存在。');
    const scope = { operationId: id, ownerId: principal.sub, libraryMode: this.libraryMode };
    const counts = await this.prisma.eagleAssetOperationItem.groupBy({
      by: ['status', 'errorCode'],
      where: { ...scope, libraryMode: this.libraryMode },
      _sum: { weight: true },
    });
    counts.sort((a, b) =>
      `${a.status}:${a.errorCode ?? ''}`.localeCompare(`${b.status}:${b.errorCode ?? ''}`),
    );
    const summary = this.summary({
      ...operation,
      items: counts.map((row) => ({ ...row, weight: row._sum.weight ?? 0 })),
    });
    const revision = JSON.stringify([operation.updatedAt.toISOString(), summary]);
    if (query.revision && query.revision !== revision)
      throw new ConflictException('操作结果已变化，请重新读取。');
    if (summary.running || summary.queued)
      return { operation: summary, revision, receipts: [], membership: [], nextCursor: null };
    const rows = await this.prisma.eagleAssetOperationItem.findMany({
      where: { ...scope, libraryMode: this.libraryMode, ordinal: { gte: query.cursor ?? 0 } },
      select: { ordinal: true, assetIds: true, snapshots: true, status: true, errorCode: true },
      orderBy: { ordinal: 'asc' },
      take: ADMISSION_BATCH_SIZE + 1,
    });
    const page = rows.slice(0, ADMISSION_BATCH_SIZE);
    const resourceIds = [
      ...new Set(page.flatMap((row) => this.receiptIds(row.assetIds, row.snapshots))),
    ];
    const membership: AssetMembershipFact[] = [];
    for (let offset = 0; offset < resourceIds.length; offset += ADMISSION_BATCH_SIZE) {
      const ids = resourceIds.slice(offset, offset + ADMISSION_BATCH_SIZE);
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
      operation: summary,
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

  /** Persist compensation before returning. The independent executor waits for running source work. */
  async undo(principal: AuthPrincipal, id: string, operationId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-admission:${principal.sub}:${this.libraryMode}:${operationId}`}, 0))::text`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-undo:${principal.sub}:${this.libraryMode}:${id}`}, 0))::text`;
          const source = await this.owned(tx, id, principal.sub, principal.canViewPrivate);
          if (source.kind !== 'TRASH' && source.kind !== 'DUPLICATE_CLEANUP')
            throw new BadRequestException('此操作不能撤销删除。');
          const existing = await tx.eagleAssetOperation.findUnique({
            where: { id: operationId, ownerId: principal.sub, libraryMode: this.libraryMode },
          });
          if (existing) {
            if (
              existing.ownerId !== principal.sub ||
              existing.libraryMode !== this.libraryMode ||
              existing.undoOfId !== id
            )
              throw new NotFoundException('操作不存在。');
            return this.summary(
              await this.owned(tx, operationId, principal.sub, principal.canViewPrivate),
            );
          }
          const priorUndo = await tx.eagleAssetOperation.findFirst({
            where: {
              ...this.libraryModeWhere(principal.sub, principal.canViewPrivate),
              kind: 'RESTORE',
              undoOfId: id,
            },
          });
          if (priorUndo)
            return this.summary(
              await this.owned(tx, priorUndo.id, principal.sub, principal.canViewPrivate),
            );
          await tx.eagleAssetOperationItem.updateMany({
            where: {
              operationId: id,
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              status: 'PENDING',
            },
            data: { status: 'CANCELLED', leaseUntil: null },
          });
          const operation = await tx.eagleAssetOperation.create({
            data: {
              id: operationId,
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              kind: 'RESTORE',
              inputIds: [],
              undoOfId: id,
              authVersion: principal.authVersion,
              isPrivate: source.isPrivate,
              privateUntil:
                source.isPrivate && principal.privacyVisibleUntil
                  ? new Date(principal.privacyVisibleUntil)
                  : null,
              items: {
                create: {
                  id: randomUUID(),
                  ordinal: 0,
                  assetIds: [],
                  snapshots: { undoOf: id },
                  weight: 1,
                },
              },
            },
            include: { items: { select: { status: true, weight: true, errorCode: true } } },
          });
          await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
          return this.summary(operation);
        },
        { timeout: OPERATION_ADMISSION_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('操作不存在。');
        throw error;
      });
  }

  private async expandUndo(item: ClaimedItem) {
    const snapshot = item.snapshots as { undoOf: string };
    await this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, item.ownerId, this.libraryMode);
        await this.assertActor(tx, item.operation, [item]);
        const source = await tx.eagleAssetOperation.findFirst({
          where: {
            id: snapshot.undoOf,
            ownerId: item.ownerId,
            libraryMode: this.libraryMode,
            kind: { in: ['TRASH', 'DUPLICATE_CLEANUP'] },
          },
          include: { items: { orderBy: { ordinal: 'asc' } } },
        });
        if (!source) throw new NotFoundException('操作不存在。');
        if (source.items.some((row) => row.status === 'RUNNING')) {
          await tx.eagleAssetOperationItem.updateMany({
            where: { libraryMode: this.libraryMode, ...this.leaseWhere([item]) },
            data: { leaseUntil: new Date(Date.now() + OPERATION_POLL_MS) },
          });
          return;
        }
        const restore = source.items
          .filter((row) => row.status === 'COMPLETED')
          .flatMap((row) => {
            const frozen = Array.isArray(row.snapshots)
              ? row.snapshots
              : (row.snapshots as { resources?: Snapshot[] })?.resources;
            if (!Array.isArray(frozen) || !frozen.length) return [];
            const resources = frozen as unknown as Snapshot[];
            return [
              {
                id: randomUUID(),
                operationId: item.operationId,
                ownerId: item.ownerId,
                libraryMode: this.libraryMode,
                ordinal: row.ordinal + 1,
                assetIds: row.assetIds,
                weight: row.weight,
                snapshots: resources.map((resource) => ({
                  ...resource,
                  rowVersion: resource.rowVersion + 1,
                })),
              },
            ];
          });
        for (let offset = 0; offset < restore.length; offset += ADMISSION_BATCH_SIZE)
          await tx.eagleAssetOperationItem.createMany({
            data: restore.slice(offset, offset + ADMISSION_BATCH_SIZE),
            skipDuplicates: true,
          });
        // Atomically replace the control item with ordinary restore items. An
        // all-cancelled source needs no resource work and completes with total 0.
        const removed = await tx.eagleAssetOperationItem.deleteMany({
          where: { libraryMode: this.libraryMode, ...this.leaseWhere([item]) },
        });
        if (removed.count !== 1) throw new OperationAccessError('LEASE_LOST');
      },
      { timeout: METADATA_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async owned(
    tx: Prisma.TransactionClient,
    id: string,
    ownerId: string,
    includePrivate: boolean,
  ) {
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
        items: { select: { status: true, weight: true, errorCode: true } },
      },
    });
    if (!operation) throw new NotFoundException('操作不存在。');
    return operation;
  }
  async enqueue(principal: AuthPrincipal, input: EnqueueAssetOperationDto) {
    if (input.kind === 'DUPLICATE_SCAN' || input.kind === 'DUPLICATE_CLEANUP')
      throw new BadRequestException('请从查重入口提交操作。');
    const ids = [...new Set(input.assetIds)].sort();
    if (input.kind === 'EMPTY_TRASH' ? ids.length !== 0 : ids.length === 0)
      throw new BadRequestException('请选择要处理的资源。');
    return this.prisma
      .$transaction(
        async (tx) => {
          // Large repeated IN batches otherwise switch to an under-estimated generic
          // owner-index scan on a freshly imported library. Keep value-aware plans
          // local to this admission transaction; never change global DB settings.
          if (ids.length > ADMISSION_BATCH_SIZE)
            await tx.$executeRaw`SET LOCAL plan_cache_mode = 'force_custom_plan'`;
          // Serialize retries of this intent, not all unrelated writes in the workspace.
          // Permissions, versions and resource membership are authoritative at execution.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-admission:${principal.sub}:${this.libraryMode}:${input.operationId}`}, 0))::text`;
          const existing = await tx.eagleAssetOperation.findUnique({
            where: { id: input.operationId, ownerId: principal.sub, libraryMode: this.libraryMode },
            include: { items: { select: { status: true, weight: true, errorCode: true } } },
          });
          if (existing) {
            if (
              existing.ownerId !== principal.sub ||
              existing.libraryMode !== this.libraryMode ||
              (existing.isPrivate && !principal.canViewPrivate)
            )
              throw new NotFoundException('操作不存在。');
            if (
              existing.kind !== input.kind ||
              JSON.stringify(existing.inputIds) !== JSON.stringify(ids)
            )
              throw new ConflictException('操作标识与选择不一致。');
            return this.summary(existing);
          }
          const resourcesById = new Map<
            string,
            Awaited<ReturnType<typeof resolveEagleTrashTargets>>[number]
          >();
          const unavailable: string[] = [],
            alreadyRemoved: string[] = [];
          let skippedPrivate = false;
          const activeIds: string[] = [];
          if (input.kind === 'TRASH') {
            for (let offset = 0; offset < ids.length; offset += ADMISSION_BATCH_SIZE) {
              const part = ids.slice(offset, offset + ADMISSION_BATCH_SIZE);
              const owned = await tx.eagleAsset.findMany({
                where: {
                  ownerId: principal.sub,
                  libraryMode: this.libraryMode,
                  id: { in: part },
                  ...(principal.canViewPrivate ? {} : { isPrivate: false }),
                },
                select: { id: true, deletedAt: true, isPrivate: true },
              });
              const byId = new Map(owned.map((row) => [row.id, row]));
              for (const id of part) {
                const row = byId.get(id);
                if (!row) unavailable.push(id);
                else if (row.deletedAt) {
                  alreadyRemoved.push(id);
                  skippedPrivate ||= row.isPrivate;
                } else activeIds.push(id);
              }
            }
            // No inaccessible resource is ever resolved or touched. An entirely
            // unavailable selection retains the same owner/private 404 contract.
            if (!activeIds.length && !alreadyRemoved.length)
              throw new NotFoundException('一个或多个素材不存在。');
          } else activeIds.push(...ids);
          for (let offset = 0; offset < activeIds.length; offset += ADMISSION_BATCH_SIZE) {
            const part = await resolveEagleTrashTargets(
              tx,
              { ownerId: principal.sub, libraryMode: this.libraryMode },
              activeIds.slice(offset, offset + ADMISSION_BATCH_SIZE),
              input.kind === 'RESTORE',
              principal.canViewPrivate,
            );
            for (const resource of part) resourcesById.set(resource.id, resource);
          }
          const rows: Array<{
            id: string;
            livePhotoIdentifier: string | null;
            isPrivate: boolean;
            mimeType: string;
            lifecycleStatus: string;
          }> = [];
          const resourceIds = [...resourcesById.keys()];
          for (let offset = 0; offset < resourceIds.length; offset += ADMISSION_BATCH_SIZE) {
            rows.push(
              ...(await tx.eagleAsset.findMany({
                where: {
                  id: { in: resourceIds.slice(offset, offset + ADMISSION_BATCH_SIZE) },
                  ownerId: principal.sub,
                  libraryMode: this.libraryMode,
                },
                select: {
                  id: true,
                  livePhotoIdentifier: true,
                  isPrivate: true,
                  mimeType: true,
                  lifecycleStatus: true,
                },
              })),
            );
          }
          const rowsById = new Map(rows.map((row) => [row.id, row]));
          if (
            input.kind === 'SEND' &&
            ids.some((id) => {
              const row = rowsById.get(id);
              return !row || !row.mimeType.startsWith('image/') || row.lifecycleStatus !== 'READY';
            })
          )
            throw new ConflictException('请等待图片处理完成后发送。');
          const isPrivate =
            skippedPrivate ||
            rows.some((row) => row.isPrivate) ||
            (input.kind === 'EMPTY_TRASH' &&
              principal.canViewPrivate &&
              (await tx.eagleAsset.count({
                where: {
                  ownerId: principal.sub,
                  libraryMode: this.libraryMode,
                  deletedAt: { not: null },
                  purgeAfter: null,
                  isPrivate: true,
                },
              })) > 0);
          const privateUntil =
            isPrivate && principal.privacyVisibleUntil
              ? new Date(principal.privacyVisibleUntil)
              : null;
          if (isPrivate && (!privateUntil || privateUntil <= new Date()))
            throw new NotFoundException('私密授权已失效。');
          // A live photo and its motion stay one atomic domain operation, including
          // selections which contain both components or more than one shared anchor.
          const groups = new Map<string, Snapshot[]>();
          for (const row of rows) {
            const key = row.livePhotoIdentifier ? `live:${row.livePhotoIdentifier}` : row.id;
            const group = groups.get(key) ?? [];
            const resource = resourcesById.get(row.id)!;
            group.push({
              id: resource.id,
              mediaRevision: resource.mediaRevision,
              rowVersion: resource.rowVersion,
            });
            groups.set(key, group);
          }
          const selectedIds = new Set(ids);
          const items =
            input.kind === 'EMPTY_TRASH'
              ? [{ assetIds: [], snapshots: [], weight: 1 }]
              : [...groups.values()]
                  .map((snapshots) => {
                    const assetIds = snapshots
                      .map((row) => row.id)
                      .filter((id) => selectedIds.has(id));
                    return { assetIds, snapshots, weight: assetIds.length };
                  })
                  .filter((item) => item.weight > 0);
          const outcomes = [
            ...items.map((item) => ({
              ...item,
              status: 'PENDING',
              errorCode: null as string | null,
            })),
            ...alreadyRemoved.map((id) => ({
              assetIds: [id],
              snapshots: [],
              weight: 1,
              status: 'SKIPPED',
              errorCode: null as string | null,
            })),
            ...unavailable.map((id) => ({
              assetIds: [id],
              snapshots: [],
              weight: 1,
              status: 'FAILED',
              errorCode: 'NOT_FOUND',
            })),
          ];
          const operation = await tx.eagleAssetOperation.create({
            data: {
              id: input.operationId,
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              kind: input.kind,
              inputIds: ids,
              authVersion: principal.authVersion,
              isPrivate,
              privateUntil,
            },
          });
          const pendingItems = outcomes.map((item, ordinal) => ({
            id: randomUUID(),
            operationId: operation.id,
            ownerId: principal.sub,
            libraryMode: this.libraryMode,
            ordinal,
            assetIds: item.assetIds,
            weight: item.weight,
            snapshots: item.snapshots,
            status: item.status,
            errorCode: item.errorCode,
          }));
          for (let offset = 0; offset < pendingItems.length; offset += ADMISSION_BATCH_SIZE) {
            await tx.eagleAssetOperationItem.createMany({
              data: pendingItems.slice(offset, offset + ADMISSION_BATCH_SIZE),
            });
          }
          await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
          return this.summary({
            ...operation,
            items: outcomes.map((item) => ({
              status: item.status,
              weight: item.weight,
              errorCode: item.errorCode,
            })),
          });
        },
        { timeout: OPERATION_ADMISSION_TIMEOUT_MS },
      )
      .then((result) => {
        this.wake();
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028')
          throw new RequestTimeoutException('批量任务准备超时，请重试；已创建的任务不会重复执行。');
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('操作不存在。');
        throw error;
      });
  }
  async retry(principal: AuthPrincipal, id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const operation = await this.owned(tx, id, principal.sub, principal.canViewPrivate);
      const privateUntil =
        operation.isPrivate && principal.privacyVisibleUntil
          ? new Date(principal.privacyVisibleUntil)
          : null;
      if (operation.isPrivate && (!privateUntil || privateUntil <= new Date()))
        throw new NotFoundException('操作不存在。');
      await tx.eagleAssetOperation.update({
        where: { id: operation.id, ownerId: principal.sub, libraryMode: this.libraryMode },
        data: { authVersion: principal.authVersion, privateUntil },
      });
      await tx.eagleAssetOperationItem.updateMany({
        where: {
          operationId: operation.id,
          ownerId: principal.sub,
          libraryMode: this.libraryMode,
          status: 'FAILED',
        },
        data: { status: 'PENDING', errorCode: null, leaseUntil: null },
      });
      if (operation.kind === 'DUPLICATE_SCAN')
        await tx.eagleAssetOperationItem.updateMany({
          where: {
            operationId: operation.id,
            ownerId: principal.sub,
            libraryMode: this.libraryMode,
            status: 'COMPLETED',
            OR: [
              { snapshots: { path: ['kind'], equals: 'build' } },
              { snapshots: { path: ['kind'], equals: 'publish' } },
            ],
          },
          data: { status: 'PENDING', errorCode: null, leaseUntil: null },
        });
      await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
      return this.summary(await this.owned(tx, id, principal.sub, principal.canViewPrivate));
    });
    this.wake();
    return result;
  }
  async cancel(principal: AuthPrincipal, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.owned(tx, id, principal.sub, principal.canViewPrivate);
      await tx.eagleAssetOperationItem.updateMany({
        where: {
          operationId: operation.id,
          ownerId: principal.sub,
          libraryMode: this.libraryMode,
          status: 'PENDING',
        },
        data: { status: 'CANCELLED', leaseUntil: null },
      });
      return this.summary(await this.owned(tx, id, principal.sub, principal.canViewPrivate));
    });
  }
  private wake() {
    if (!this.timer || this.stopping) return;
    void this.tick().catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED'));
  }
  private async claim(lane: OperationLane): Promise<ClaimedItem[]> {
    // Only a hint: the locked transaction below remains the sole claim authority.
    // Other API processes discover committed work within the five-second fallback.
    const candidate = await this.prisma.eagleAssetOperationItem.findFirst({
      where: {
        libraryMode: this.libraryMode,
        operation: { kind: laneKind(lane) },
        OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseUntil: { lte: new Date() } }],
      },
      select: { id: true },
    });
    if (!candidate) return [];
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-operations:${this.libraryMode}`}))`;
      const now = new Date();
      const operation = { kind: laneKind(lane) };
      if (
        await tx.eagleAssetOperationItem.count({
          where: {
            libraryMode: this.libraryMode,
            operation,
            status: 'RUNNING',
            leaseUntil: { gt: now },
          },
        })
      )
        return [];
      const available = {
        OR: [{ status: 'PENDING' }, { status: 'RUNNING', leaseUntil: { lte: now } }],
      };
      const first = await tx.eagleAssetOperationItem.findFirst({
        where: { libraryMode: this.libraryMode, ...available, operation },
        orderBy: [
          ...(lane === 'SEND'
            ? [{ operation: { lastClaimedAt: { sort: 'asc' as const, nulls: 'first' as const } } }]
            : []),
          { operation: { createdAt: 'asc' } },
          { ordinal: 'asc' },
        ],
        include: { operation: true },
      });
      if (!first) return [];
      // Only one command is batched: owner, authorization, kind and frozen selection
      // stay together. Persisted per-resource receipts and retry identities are unchanged.
      const candidates = ['EMPTY_TRASH', 'DUPLICATE_SCAN', 'DUPLICATE_CLEANUP'].includes(
        first.operation.kind,
      )
        ? [first]
        : await tx.eagleAssetOperationItem.findMany({
            where: {
              libraryMode: this.libraryMode,
              ...available,
              operationId: first.operationId,
              ownerId: first.ownerId,
            },
            orderBy: { ordinal: 'asc' },
            take: lane === 'SEND' ? SEND_CONCURRENCY : METADATA_BATCH_SIZE,
          });
      if (!candidates.length) return [];
      const claimed = await tx.eagleAssetOperationItem.updateMany({
        where: {
          libraryMode: this.libraryMode,
          ...available,
          ownerId: first.ownerId,
          operationId: first.operationId,
          AND: { OR: candidates.map(({ id, leaseVersion }) => ({ id, leaseVersion })) },
        },
        data: {
          status: 'RUNNING',
          errorCode: null,
          leaseUntil: new Date(Date.now() + LEASE_MS),
          leaseVersion: { increment: 1 },
        },
      });
      if (!claimed.count) return [];
      if (lane === 'SEND')
        await tx.eagleAssetOperation.update({
          where: { id: first.operationId, ownerId: first.ownerId, libraryMode: this.libraryMode },
          data: { lastClaimedAt: now },
        });
      return tx.eagleAssetOperationItem.findMany({
        where: {
          ownerId: first.ownerId,
          libraryMode: this.libraryMode,
          operationId: first.operationId,
          status: 'RUNNING',
          OR: candidates.map(({ id, leaseVersion }) => ({ id, leaseVersion: leaseVersion + 1 })),
        },
        orderBy: { ordinal: 'asc' },
        include: { operation: true },
      });
    });
  }
  private async assertActor(
    tx: Prisma.TransactionClient,
    operation: EagleAssetOperation,
    items: ClaimedItem[],
  ) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${operation.ownerId} FOR SHARE`;
    const user = await tx.user.findUnique({
      where: { id: operation.ownerId },
      select: { authVersion: true, disabledAt: true },
    });
    if (!user || user.disabledAt || user.authVersion !== operation.authVersion)
      throw new OperationAccessError('AUTH_REQUIRED');
    this.assertPrivateGrant(operation);
    const leased = await tx.eagleAssetOperationItem.updateMany({
      where: {
        libraryMode: this.libraryMode,
        ...this.leaseWhere(items),
        leaseUntil: { gt: new Date() },
      },
      data: { updatedAt: new Date() },
    });
    if (leased.count !== items.length) throw new OperationAccessError('LEASE_LOST');
  }
  private assertPrivateGrant(operation: EagleAssetOperation) {
    if (operation.isPrivate && (!operation.privateUntil || operation.privateUntil <= new Date()))
      throw new OperationAccessError('PRIVATE_LOCKED');
  }
  private async checkSnapshots(
    tx: Prisma.TransactionClient,
    operation: EagleAssetOperation,
    snapshots: Snapshot[],
  ) {
    const rows = await tx.eagleAsset.findMany({
      where: {
        id: { in: snapshots.map((row) => row.id) },
        ownerId: operation.ownerId,
        libraryMode: this.libraryMode,
        ...(operation.isPrivate ? {} : { isPrivate: false }),
      },
      select: { id: true, rowVersion: true, mediaRevision: true },
    });
    if (rows.length !== snapshots.length) throw new NotFoundException('资源不可访问。');
    if (
      snapshots.some(
        (snapshot) =>
          !rows.some(
            (row) =>
              row.id === snapshot.id &&
              row.rowVersion === snapshot.rowVersion &&
              row.mediaRevision === snapshot.mediaRevision,
          ),
      )
    )
      throw new ConflictException('资源已变化。');
  }
  private leaseWhere(items: ClaimedItem[]): Prisma.EagleAssetOperationItemWhereInput {
    return {
      ownerId: items[0]!.ownerId,
      status: 'RUNNING',
      OR: items.map(({ id, leaseVersion }) => ({ id, leaseVersion })),
    };
  }
  async tick() {
    const results = await Promise.allSettled([
      this.tickLane('SEND'),
      this.tickLane('METADATA'),
      this.tickLane('SCAN'),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  private async tickLane(lane: OperationLane) {
    if (this.stopping) return;
    if (this.running.has(lane)) {
      this.pendingWake.add(lane);
      return;
    }
    this.running.add(lane);
    let heartbeat: NodeJS.Timeout | undefined;
    let processed = false;
    try {
      const items = await this.claim(lane);
      if (!items.length) return;
      processed = true;
      heartbeat = setInterval(() => {
        void this.prisma.eagleAssetOperationItem
          .updateMany({
            where: {
              libraryMode: this.libraryMode,
              ...this.leaseWhere(items),
              leaseUntil: { gt: new Date() },
            },
            data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
          })
          .catch(() => this.logger.warn('ASSET_OPERATION_HEARTBEAT_FAILED'));
      }, 5000);
      heartbeat.unref();
      await this.execute(items);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.running.delete(lane);
      const pendingWake = this.pendingWake.delete(lane);
      if ((processed || pendingWake) && !this.stopping && this.timer) {
        const next = setTimeout(
          () =>
            void this.tickLane(lane).catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED')),
          0,
        );
        next.unref();
      }
    }
  }
  private async execute(items: ClaimedItem[]) {
    const item = items[0]!;
    const { operation } = item;
    const libraryModeIdentity = { libraryMode: this.libraryMode, ...this.leaseWhere(items) };
    try {
      if (
        operation.kind === 'RESTORE' &&
        !Array.isArray(item.snapshots) &&
        item.snapshots &&
        typeof item.snapshots === 'object' &&
        'undoOf' in item.snapshots
      ) {
        await this.expandUndo(item);
        return;
      }
      if (operation.kind === 'DUPLICATE_SCAN' || operation.kind === 'DUPLICATE_CLEANUP') {
        if (!this.duplicates) throw new Error('Duplicate executor is unavailable');
        if (operation.kind === 'DUPLICATE_SCAN')
          await this.prisma.$transaction((tx) => this.assertActor(tx, operation, items));
        for (const entry of items)
          await this.duplicates.execute(entry, (tx) => this.assertActor(tx, operation, [entry]));
        return;
      }
      // The transfer journal alone owns idempotency; its completed result can be
      // replayed after credential changes without attempting any new resource write.
      if (operation.kind === 'EMPTY_TRASH')
        await this.prisma.$transaction((tx) => this.assertActor(tx, operation, items));
      const snapshots = items.flatMap((entry) => entry.snapshots as unknown as Snapshot[]);
      const assetIds = items.flatMap((entry) => entry.assetIds);
      const beforeWrite = (tx: Prisma.TransactionClient) => this.assertActor(tx, operation, items);
      if (operation.kind === 'SEND') {
        const published = new Set<string>();
        const requests = items.map((entry) => {
          const entrySnapshots = entry.snapshots as unknown as Snapshot[];
          return {
            input: { assetIds: entry.assetIds, operationId: entry.id },
            expected: new Map(entrySnapshots.map((row) => [row.id, row])),
            guard: {
              beforePublish: (tx: Prisma.TransactionClient) =>
                this.assertActor(tx, operation, [entry]),
              beforeCopy: () =>
                this.prisma.$transaction((tx) => this.assertActor(tx, operation, [entry])),
              afterPublish: async (tx: Prisma.TransactionClient) => {
                this.assertPrivateGrant(operation);
                const updated = await tx.eagleAssetOperationItem.updateMany({
                  where: { libraryMode: this.libraryMode, ...this.leaseWhere([entry]) },
                  data: { status: 'COMPLETED', leaseUntil: null },
                });
                if (updated.count !== 1) throw new OperationAccessError('LEASE_LOST');
                published.add(entry.id);
              },
              componentIds: entrySnapshots.map((row) => row.id),
            },
          };
        });
        const failed = new Set<string>();
        if (requests.length === 1) {
          const request = requests[0]!;
          await this.transfers.send(
            operation.ownerId,
            request.input,
            operation.isPrivate,
            request.expected,
            request.guard,
          );
        } else {
          const results = await this.transfers.sendBatch(
            operation.ownerId,
            requests,
            operation.isPrivate,
          );
          for (const [index, result] of results.entries()) {
            if (result.status !== 'rejected') continue;
            const entry = items[index]!;
            failed.add(entry.id);
            await this.failItems([entry], result.reason);
          }
        }
        // A completed journal can be replayed after a crash without publishing again.
        const replayed = items.filter((entry) => !published.has(entry.id) && !failed.has(entry.id));
        if (replayed.length)
          await this.prisma.eagleAssetOperationItem.updateMany({
            where: { libraryMode: this.libraryMode, ...this.leaseWhere(replayed) },
            data: { status: 'COMPLETED', leaseUntil: null },
          });
        return;
      } else if (operation.kind === 'EMPTY_TRASH') {
        await this.eagle.emptyTrash(
          operation.ownerId,
          operation.isPrivate,
          operation.createdAt,
          beforeWrite,
        );
      } else {
        await this.prisma.$transaction(
          async (tx) => {
            await lockOwnerPrivacyProjection(tx, operation.ownerId, this.libraryMode);
            await beforeWrite(tx);
            const ids = snapshots.map((row) => row.id).sort();
            await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${operation.ownerId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
            try {
              await this.checkSnapshots(tx, operation, snapshots);
            } catch (error) {
              // A queued deletion is idempotent when its previously owned resources
              // have all disappeared. Changed active/private resources still fail.
              if (
                operation.kind !== 'TRASH' ||
                items.length !== 1 ||
                !(error instanceof NotFoundException || error instanceof ConflictException)
              )
                throw error;
              const remaining = await tx.eagleAsset.findMany({
                where: {
                  ownerId: operation.ownerId,
                  libraryMode: this.libraryMode,
                  id: { in: ids },
                },
                select: { deletedAt: true },
              });
              if (remaining.some((row) => row.deletedAt === null)) throw error;
              this.assertPrivateGrant(operation);
              await tx.eagleAssetOperationItem.updateMany({
                where: { ...libraryModeIdentity },
                data: { status: 'SKIPPED', leaseUntil: null },
              });
              return;
            }
            const current = await resolveEagleTrashTargets(
              tx,
              { ownerId: operation.ownerId, libraryMode: this.libraryMode },
              assetIds,
              operation.kind === 'RESTORE',
              operation.isPrivate,
              items.map((entry) => ({
                assetIds: entry.assetIds,
                resourceIds: (entry.snapshots as unknown as Snapshot[]).map((row) => row.id),
              })),
            );
            if (JSON.stringify(current.map((row) => row.id).sort()) !== JSON.stringify(ids))
              throw new ConflictException('实况照片组件已变化。');
            await setEagleTrash(
              tx,
              { ownerId: operation.ownerId, libraryMode: this.libraryMode },
              assetIds,
              operation.kind === 'RESTORE',
              operation.isPrivate,
            );
            // A lock wait or bulk write can outlive the grant checked on entry.
            // Fail inside this transaction so resources and receipts roll back together.
            this.assertPrivateGrant(operation);
            await tx.eagleAssetOperationItem.updateMany({
              where: { ...libraryModeIdentity },
              data: { status: 'COMPLETED', leaseUntil: null },
            });
          },
          { timeout: METADATA_TRANSACTION_TIMEOUT_MS },
        );
        return;
      }
      await this.prisma.eagleAssetOperationItem.updateMany({
        where: { ...libraryModeIdentity },
        data: { status: 'COMPLETED', leaseUntil: null },
      });
    } catch (error) {
      if (
        items.length > 1 &&
        (error instanceof NotFoundException || error instanceof ConflictException)
      ) {
        // The fast path was rolled back. Keep unaffected resources actionable,
        // while preserving the exact per-item conflict and retry semantics.
        for (const entry of items) await this.execute([entry]);
        return;
      }
      await this.failItems(items, error);
    }
  }
  private async failItems(items: ClaimedItem[], error: unknown) {
    const { operation } = items[0]!;
    const libraryModeIdentity = { libraryMode: this.libraryMode, ...this.leaseWhere(items) };
    const duplicateCode =
      error instanceof Error &&
      [
        'DUPLICATE_ORIGINAL_TOO_LARGE',
        'DUPLICATE_ORIGINAL_HASH_MISMATCH',
        'INVALID_DUPLICATE_ORIGINAL_BUDGET',
      ].includes(error.message)
        ? error.message
        : null;
    const code =
      duplicateCode ??
      (error instanceof OperationAccessError
        ? error.code
        : error instanceof NotFoundException
          ? 'ASSET_UNAVAILABLE'
          : error instanceof ConflictException
            ? 'ASSET_CHANGED'
            : error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028'
              ? 'TRANSACTION_TIMEOUT'
              : 'OPERATION_FAILED');
    this.logger.error({
      event: 'ASSET_OPERATION_FAILED',
      operationId: operation.id,
      itemIds: items.map((entry) => entry.id),
      kind: operation.kind,
      libraryMode: this.libraryMode,
      errorCode: code,
      databaseCode: error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined,
      errorType: error instanceof Error ? error.constructor.name : 'Unknown',
    });
    await this.prisma.eagleAssetOperationItem.updateMany({
      where: { ...libraryModeIdentity },
      data: { status: 'FAILED', errorCode: code, leaseUntil: null },
    });
    if (code === 'AUTH_REQUIRED' || code === 'PRIVATE_LOCKED') {
      await this.prisma.eagleAssetOperationItem.updateMany({
        where: {
          operationId: operation.id,
          ownerId: operation.ownerId,
          libraryMode: this.libraryMode,
          status: 'PENDING',
        },
        data: { status: 'FAILED', errorCode: code },
      });
    }
  }
}
