import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
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
  items: Array<Pick<EagleAssetOperationItem, 'status' | 'weight' | 'errorCode'>>;
};
const LEASE_MS = 120_000;
const METADATA_BATCH_SIZE = 32;
// Transfer publication may hold the shared privacy lock for up to 30 seconds.
// Leave a bounded write budget after that wait, inside the 120-second lease.
const METADATA_TRANSACTION_TIMEOUT_MS = 45_000;
type OperationLane = 'SEND' | 'METADATA';
type ClaimedItem = EagleAssetOperationItem & { operation: EagleAssetOperation };
class OperationAccessError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Durable orchestration only: domain writes stay in the existing transfer/trash services. */
@Injectable()
export class EagleAssetOperationService implements OnModuleInit, OnModuleDestroy {
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
  ) {}
  onModuleInit() {
    if (process.env.EAGLE_ASSET_OPERATIONS_ENABLED === 'false') return;
    this.timer = setInterval(
      () => void this.tick().catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED')),
      5000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
  }

  // Local admissions do not wait for the cross-process recovery poll. Wake only
  // after the admitting transaction commits; durable claims remain authoritative.
  private wake() {
    if (this.timer && !this.stopping) {
      this.pendingWake.add('SEND');
      this.pendingWake.add('METADATA');
      void this.tick().catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED'));
    }
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
      completed: count('COMPLETED'),
      failed: count('FAILED'),
      cancelled: count('CANCELLED'),
    };
    const errors = new Map<string, number>();
    for (const item of operation.items)
      if (item.status === 'FAILED' && item.errorCode)
        errors.set(item.errorCode, (errors.get(item.errorCode) ?? 0) + item.weight);
    return {
      id: operation.id,
      kind: operation.kind as AssetOperationKind,
      libraryMode: operation.libraryMode,
      total: operation.items.reduce((n, item) => n + item.weight, 0),
      ...counts,
      state: assetOperationState(counts),
      errors: [...errors].map(([code, count]) => ({ code, count })),
    };
  }
  async list(ownerId: string, includePrivate = false) {
    const select = { id: true, kind: true, libraryMode: true } as const;
    const [active, recent] = await Promise.all([
      this.prisma.eagleAssetOperation.findMany({
        where: {
          ...this.libraryModeWhere(ownerId, includePrivate),
          items: { some: { status: { in: ['PENDING', 'RUNNING'] } } },
        },
        select,
        orderBy: { createdAt: 'asc' },
        take: 20,
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

  private async owned(
    tx: Prisma.TransactionClient,
    id: string,
    ownerId: string,
    includePrivate: boolean,
  ) {
    const operation = await tx.eagleAssetOperation.findFirst({
      where: { id, ...this.libraryModeWhere(ownerId, includePrivate) },
      include: { items: true },
    });
    if (!operation) throw new NotFoundException('操作不存在。');
    return operation;
  }
  async enqueue(principal: AuthPrincipal, input: EnqueueAssetOperationDto) {
    const ids = [...new Set(input.assetIds)].sort();
    if (
      ids.length !== input.assetIds.length ||
      ids.length > 1000 ||
      (input.kind === 'EMPTY_TRASH' ? ids.length !== 0 : ids.length === 0)
    )
      throw new BadRequestException('请选择不重复的资源。');
    return this.prisma
      .$transaction(
        async (tx) => {
          await lockOwnerPrivacyProjection(tx, principal.sub, this.libraryMode);
          const existing = await tx.eagleAssetOperation.findUnique({
            where: { id: input.operationId, ownerId: principal.sub, libraryMode: this.libraryMode },
            include: { items: true },
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
          const active = await tx.eagleAssetOperation.count({
            where: {
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              items: { some: { status: { in: ['PENDING', 'RUNNING'] } } },
            },
          });
          if (active >= 20) throw new ConflictException('排队操作较多，请稍后再试。');
          const resources =
            input.kind === 'EMPTY_TRASH'
              ? []
              : await resolveEagleTrashTargets(
                  tx,
                  { ownerId: principal.sub, libraryMode: this.libraryMode },
                  ids,
                  input.kind === 'RESTORE',
                  principal.canViewPrivate,
                );
          const rows = resources.length
            ? await tx.eagleAsset.findMany({
                where: {
                  id: { in: resources.map((row) => row.id) },
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
              })
            : [];
          if (
            input.kind === 'SEND' &&
            ids.some(
              (id) =>
                !rows.some(
                  (row) =>
                    row.id === id &&
                    row.mimeType.startsWith('image/') &&
                    row.lifecycleStatus === 'READY',
                ),
            )
          )
            throw new ConflictException('请等待图片处理完成后发送。');
          const isPrivate =
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
            const resource = resources.find((candidate) => candidate.id === row.id)!;
            group.push({
              id: resource.id,
              mediaRevision: resource.mediaRevision,
              rowVersion: resource.rowVersion,
            });
            groups.set(key, group);
          }
          const items =
            input.kind === 'EMPTY_TRASH'
              ? [{ assetIds: [], snapshots: [], weight: 1 }]
              : [...groups.values()]
                  .map((snapshots) => {
                    const assetIds = ids.filter((id) => snapshots.some((row) => row.id === id));
                    return { assetIds, snapshots, weight: assetIds.length };
                  })
                  .filter((item) => item.weight > 0);
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
              items: {
                createMany: {
                  data: items.map((item, ordinal) => ({
                    id: randomUUID(),
                    ordinal,
                    assetIds: item.assetIds,
                    weight: item.weight,
                    snapshots: item.snapshots,
                  })),
                },
              },
            },
            include: { items: true },
          });
          return this.summary(operation);
        },
        { timeout: 15000 },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('操作不存在。');
        throw error;
      })
      .then((result) => {
        this.wake();
        return result;
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
  private async claim(lane: OperationLane): Promise<ClaimedItem[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`asset-operations:${this.libraryMode}`}))`;
      const now = new Date();
      const operation = { kind: lane === 'SEND' ? 'SEND' : { not: 'SEND' } };
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
        orderBy: [{ operation: { createdAt: 'asc' } }, { ordinal: 'asc' }],
        include: { operation: true },
      });
      if (!first) return [];
      // Only one command is batched: owner, authorization, kind and frozen selection
      // stay together. Persisted per-resource receipts and retry identities are unchanged.
      const candidates =
        lane === 'SEND' || first.operation.kind === 'EMPTY_TRASH'
          ? [first]
          : await tx.eagleAssetOperationItem.findMany({
              where: {
                libraryMode: this.libraryMode,
                ...available,
                operationId: first.operationId,
                ownerId: first.ownerId,
              },
              orderBy: { ordinal: 'asc' },
              take: METADATA_BATCH_SIZE,
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
    const results = await Promise.allSettled([this.tickLane('SEND'), this.tickLane('METADATA')]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  private async tickLane(lane: OperationLane) {
    if (this.running.has(lane) || this.stopping) return;
    this.pendingWake.delete(lane);
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
      if ((processed || this.pendingWake.has(lane)) && !this.stopping && this.timer) {
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
      // Publication is authoritative even if a crash delayed the queue receipt.
      // Recording an already committed result performs no resource write and
      // must not misreport success as failure after a later credential change.
      const previous =
        operation.kind === 'SEND'
          ? await this.prisma.eagleLibraryTransfer.findUnique({
              where: { id: item.id, ownerId: operation.ownerId, sourceMode: this.libraryMode },
            })
          : null;
      if (previous?.status === 'COMPLETED') {
        await this.prisma.eagleAssetOperationItem.updateMany({
          where: { ...libraryModeIdentity },
          data: { status: 'COMPLETED', leaseUntil: null },
        });
        return;
      }
      if (operation.kind === 'SEND' || operation.kind === 'EMPTY_TRASH')
        await this.prisma.$transaction((tx) => this.assertActor(tx, operation, items));
      const snapshots = items.flatMap((entry) => entry.snapshots as unknown as Snapshot[]);
      const assetIds = items.flatMap((entry) => entry.assetIds);
      const beforeWrite = (tx: Prisma.TransactionClient) => this.assertActor(tx, operation, items);
      if (operation.kind === 'SEND') {
        await this.prisma.$transaction((tx) => this.checkSnapshots(tx, operation, snapshots));
        await this.transfers.send(
          operation.ownerId,
          { assetIds: assetIds, operationId: item.id },
          operation.isPrivate,
          new Map(snapshots.map((row) => [row.id, row])),
          { beforePublish: beforeWrite, componentIds: snapshots.map((row) => row.id) },
        );
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
            await this.checkSnapshots(tx, operation, snapshots);
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
      const code =
        error instanceof OperationAccessError
          ? error.code
          : error instanceof NotFoundException
            ? 'ASSET_UNAVAILABLE'
            : error instanceof ConflictException
              ? 'ASSET_CHANGED'
              : 'OPERATION_FAILED';
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
}
