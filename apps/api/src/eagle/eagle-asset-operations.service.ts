import { lockOperationPublication, OperationCancelledError } from './eagle-operation-cancellation';
import {
  LibraryCommandRegistry,
  libraryCommandPayload,
  type LibraryCommandContext,
  type LibraryCommandInput,
  type LibraryCommandSnapshot,
} from './eagle-library-command';
import { operationIdlePollDelay } from './operation-idle-schedule';
import { EagleDuplicateService } from './eagle-duplicates.service';
import {
  OPERATION_SEND_CONCURRENCY,
  OPERATION_POLL_MS,
  OPERATION_METADATA_BATCH_SIZE,
} from './eagle-operation-settings';
import {
  BadRequestException,
  ServiceUnavailableException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Prisma, type EagleAssetOperation, type LibraryMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  assetOperationProtocol,
  ASSET_OPERATION_PROTOCOLS,
  type MetadataOperationKind,
  type AssetOperationKind,
} from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { LibraryOperationAdmissionService } from './library-operation-admission.service';
import { LibraryOperationQueryService } from './library-operation-query.service';
import type { ClaimedItem, Snapshot } from './library-operation-types';
import { EagleService } from './eagle.service';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';
import { resolveEagleTrashTargets, setEagleTrash } from './eagle-trash';
import { lockOwnerPrivacyProjection } from './eagle-privacy.service';
import { databaseBatches, DATABASE_STATEMENTS } from './eagle-database-batches';
import type { CleanupSnapshot, ScanSnapshot } from './eagle-duplicate-model';
import type { EnqueueAssetOperationDto } from './eagle-asset-operations.dto';

const LEASE_MS = 120_000;
const METADATA_BATCH_SIZE = OPERATION_METADATA_BATCH_SIZE;
const SEND_CONCURRENCY = OPERATION_SEND_CONCURRENCY;
// Transfer publication may hold the shared privacy lock for up to 30 seconds.
// Leave a bounded write budget after that wait, inside the 120-second lease.
const METADATA_TRANSACTION_TIMEOUT_MS = 45_000;
type OperationLane = 'SEND' | 'METADATA' | 'SCAN' | 'COMMAND';
const laneKind = (lane: OperationLane) =>
  lane === 'COMMAND'
    ? 'BACKGROUND_COMMAND'
    : lane === 'SEND'
      ? 'SEND'
      : lane === 'SCAN'
        ? 'DUPLICATE_SCAN'
        : { notIn: ['SEND', 'DUPLICATE_SCAN', 'BACKGROUND_COMMAND'] };
type OperationSnapshots = {
  METADATA_COMMAND: LibraryCommandSnapshot;
  BACKGROUND_COMMAND: LibraryCommandSnapshot;
  SEND: Snapshot[];
  TRASH: Snapshot[];
  RESTORE: Snapshot[] | { undoOf: string };
  EMPTY_TRASH: Snapshot[];
  DUPLICATE_SCAN: ScanSnapshot;
  DUPLICATE_CLEANUP: CleanupSnapshot;
};
type AuthorizedBatch<K extends AssetOperationKind> = Array<
  Omit<ClaimedItem, 'operation' | 'snapshots'> & {
    operation: EagleAssetOperation & { kind: K };
    snapshots: OperationSnapshots[K];
  }
>;
type MetadataHandler<K extends MetadataOperationKind> = {
  protocol: 'METADATA';
  apply: (
    tx: Prisma.TransactionClient,
    batch: AuthorizedBatch<K>,
  ) => Promise<'SKIPPED' | void | { privacyChanged?: boolean }>;
};
type HandlerFor<K extends AssetOperationKind> = K extends MetadataOperationKind
  ? MetadataHandler<K>
  : {
      protocol: (typeof ASSET_OPERATION_PROTOCOLS)[K]['execution'];
      execute: (items: ClaimedItem[]) => Promise<void>;
    };
type OperationHandlers = { [K in AssetOperationKind]: HandlerFor<K> };
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
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
    @Optional() private readonly duplicates?: EagleDuplicateService,
    @Optional() private readonly commands?: LibraryCommandRegistry,
    @Optional() private readonly query?: LibraryOperationQueryService,
    @Optional() private readonly admission?: LibraryOperationAdmissionService,
  ) {}
  get mode() {
    return this.libraryMode;
  }
  private queryServiceValue?: LibraryOperationQueryService;
  private get queryService(): LibraryOperationQueryService {
    return (this.queryServiceValue ??=
      this.query ?? new LibraryOperationQueryService(this.prisma, this.libraryMode));
  }
  private admissionServiceValue?: LibraryOperationAdmissionService;
  private get admissionService(): LibraryOperationAdmissionService {
    return (this.admissionServiceValue ??=
      this.admission ??
      new LibraryOperationAdmissionService(
        this.prisma,
        this.queryService,
        this.libraryMode,
        this.commands,
      ));
  }
  private idlePolls = 0;
  private scheduleRecoveryPoll() {
    if (this.stopping) return;
    this.timer = setTimeout(
      () => {
        void this.tick(false)
          .catch(() => this.logger.warn('ASSET_OPERATION_POLL_FAILED'))
          .finally(() => this.scheduleRecoveryPoll());
      },
      operationIdlePollDelay(OPERATION_POLL_MS, this.idlePolls),
    );
    this.timer.unref();
  }
  startExecutor() {
    if (process.env.EAGLE_ASSET_OPERATIONS_ENABLED === 'false') return;
    this.scheduleRecoveryPoll();
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async drain() {
    this.onModuleDestroy();
    while (this.running.size) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  async list(ownerId: string, includePrivate = false) {
    return this.queryService.list(ownerId, includePrivate);
  }
  async results(
    principal: AuthPrincipal,
    id: string,
    query: { cursor?: number; revision?: string },
  ) {
    return this.queryService.results(principal, id, query);
  }
  async undo(principal: AuthPrincipal, id: string, operationId: string) {
    return this.admissionService.undo(principal, id, operationId);
  }
  async enqueueCommand(principal: AuthPrincipal, input: LibraryCommandInput) {
    const result = await this.admissionService.enqueueCommand(principal, input);
    this.wake();
    return result;
  }
  async enqueue(principal: AuthPrincipal, input: EnqueueAssetOperationDto) {
    const result = await this.admissionService.enqueue(principal, input);
    this.wake();
    return result;
  }
  async retry(principal: AuthPrincipal, id: string) {
    const result = await this.admissionService.retry(principal, id);
    this.wake();
    return result;
  }
  async cancel(principal: AuthPrincipal, id: string) {
    return this.admissionService.cancel(principal, id);
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
        for (const { rows: part } of databaseBatches(restore, DATABASE_STATEMENTS.operationItems))
          await tx.eagleAssetOperationItem.createMany({
            data: part,
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

  private commandSnapshot(item: {
    snapshots: unknown;
    operation?: { commandPayload?: Prisma.JsonValue | null };
  }): LibraryCommandSnapshot {
    const snapshot = item.snapshots as LibraryCommandSnapshot;
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      typeof snapshot.type !== 'string' ||
      !snapshot.payload ||
      typeof snapshot.payload !== 'object'
    )
      throw new BadRequestException('后台操作记录无效。');
    if (snapshot.sharedPayload) {
      const payload = item.operation?.commandPayload;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload))
        throw new BadRequestException('后台操作公共参数无效。');
      return { ...snapshot, payload };
    }
    return snapshot;
  }
  private commandContext(
    item: Omit<ClaimedItem, 'snapshots'> & { snapshots: unknown },
  ): LibraryCommandContext {
    return {
      ownerId: item.operation.ownerId,
      operationId: item.operationId,
      libraryMode: this.libraryMode,
      includePrivate: item.operation.isPrivate,
      beforePublish: (tx) => this.assertActor(tx, item.operation, [item as ClaimedItem]),
    };
  }
  private async applyLibraryCommands(
    tx: Prisma.TransactionClient,
    items: Array<Omit<ClaimedItem, 'snapshots'> & { snapshots: unknown }>,
  ) {
    if (!this.commands) throw new Error('Library command executor is unavailable');
    for (const item of items) {
      const snapshot = this.commandSnapshot(item);
      const definition = this.commands.get(snapshot.type);
      if (definition.protocol !== 'METADATA') throw new BadRequestException('操作协议不一致。');
      if (snapshot.resources?.length) {
        const current = await tx.eagleAsset.findMany({
          where: {
            ownerId: item.ownerId,
            libraryMode: this.libraryMode,
            id: { in: item.assetIds },
            deletedAt: null,
            purgeAfter: null,
            ...(item.operation.isPrivate ? {} : { isPrivate: false }),
          },
          select: { id: true, mediaRevision: true },
        });
        const revisions = new Map(current.map((row) => [row.id, row.mediaRevision]));
        if (current.length !== snapshot.resources.length)
          throw new NotFoundException('资源不可访问。');
        if (snapshot.resources.some((row) => revisions.get(row.id) !== row.mediaRevision))
          throw new ConflictException('资源内容已变化。');
      }
      await definition.apply(tx, this.commandContext(item), snapshot.payload, item.assetIds);
    }
  }
  /** Isolate a conflicted chunk only after its business transaction fully rolled back. */
  private async splitLibraryCommand(item: ClaimedItem) {
    const snapshot = this.commandSnapshot(item);
    const definition = this.commands!.get(snapshot.type);
    await this.prisma.$transaction(async (tx) => {
      await this.assertActor(tx, item.operation, [item]);
      const tail = await tx.eagleAssetOperationItem.aggregate({
        where: {
          operationId: item.operationId,
          ownerId: item.ownerId,
          libraryMode: this.libraryMode,
        },
        _max: { ordinal: true },
      });
      const parts = item.assetIds.map((id) => {
        const part = definition.partition?.(snapshot.payload, [id]) ?? [
          { payload: snapshot.payload, assetIds: [id] },
        ];
        if (part.length !== 1 || part[0]!.assetIds.length !== 1)
          throw new Error('Command partition cannot isolate a resource');
        return part[0]!;
      });
      await tx.eagleAssetOperationItem.createMany({
        data: parts.map((part, index) => ({
          id: randomUUID(),
          operationId: item.operationId,
          ownerId: item.ownerId,
          libraryMode: this.libraryMode,
          ordinal: (tail._max.ordinal ?? 0) + index + 1,
          assetIds: part.assetIds,
          snapshots: libraryCommandPayload({
            ...snapshot,
            payload:
              snapshot.sharedPayload && part.payload === snapshot.payload ? {} : part.payload,
            sharedPayload: snapshot.sharedPayload && part.payload === snapshot.payload,
            resources: snapshot.resources?.filter((row) => part.assetIds.includes(row.id)),
          }),
          weight: 1,
        })),
      });
      const removed = await tx.eagleAssetOperationItem.updateMany({
        where: {
          libraryMode: this.libraryMode,
          ...this.leaseWhere([item]),
          leaseUntil: { gt: new Date() },
        },
        data: { status: 'SKIPPED', weight: 0, leaseUntil: null },
      });
      if (removed.count !== 1) throw new OperationAccessError('LEASE_LOST');
    });
  }
  private async executeLibraryCommands(items: ClaimedItem[]) {
    if (!this.commands) throw new Error('Library command executor is unavailable');
    for (const item of items) {
      const snapshot = this.commandSnapshot(item);
      const definition = this.commands.get(snapshot.type);
      if (definition.protocol !== 'BACKGROUND') throw new BadRequestException('操作协议不一致。');
      const context = this.commandContext(item);
      await this.prisma.$transaction((tx) => context.beforePublish(tx));
      await definition.execute(context, snapshot.payload, item.assetIds);
      await this.prisma.$transaction(async (tx) => {
        await context.beforePublish(tx);
        const updated = await tx.eagleAssetOperationItem.updateMany({
          where: {
            libraryMode: this.libraryMode,
            ...this.leaseWhere([item]),
            leaseUntil: { gt: new Date() },
          },
          data: { status: 'COMPLETED', leaseUntil: null },
        });
        if (updated.count !== 1) throw new OperationAccessError('LEASE_LOST');
      });
    }
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
      await lockOperationPublication(
        tx,
        { operationId: first.operationId, ownerId: first.ownerId, libraryMode: this.libraryMode },
        true,
      );
      // Only one command is batched: owner, authorization, kind and frozen selection
      // stay together. Persisted per-resource receipts and retry identities are unchanged.
      const candidates = ['EMPTY_TRASH', 'DUPLICATE_SCAN', 'BACKGROUND_COMMAND'].includes(
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
      const rows = await tx.eagleAssetOperationItem.findMany({
        where: {
          ownerId: first.ownerId,
          libraryMode: this.libraryMode,
          operationId: first.operationId,
          status: 'RUNNING',
          OR: candidates.map(({ id, leaseVersion }) => ({ id, leaseVersion: leaseVersion + 1 })),
        },
        orderBy: { ordinal: 'asc' },
      });
      // Reuse one immutable operation projection; a shared LUT must not be joined
      // and materialized once per claimed resource.
      return rows.map((row) => ({ ...row, operation: first.operation }));
    });
  }
  private async assertActor(
    tx: Prisma.TransactionClient,
    operation: EagleAssetOperation,
    items: ClaimedItem[],
  ) {
    // SEND's already claimed copy/journal unit completes; stopping only removes
    // the waiting tail. All dynamic expansion protocols honor the durable stop.
    await lockOperationPublication(
      tx,
      {
        operationId: operation.id,
        ownerId: operation.ownerId,
        libraryMode: this.libraryMode,
      },
      operation.kind === 'SEND',
    );
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
  async tick(wake = true) {
    if (wake) this.idlePolls = 0;
    const results = await Promise.allSettled([
      this.tickLane('SEND'),
      this.tickLane('METADATA'),
      this.tickLane('SCAN'),
      this.tickLane('COMMAND'),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    this.idlePolls = results.some((result) => result.status === 'fulfilled' && result.value)
      ? 0
      : this.idlePolls + 1;
  }
  private async tickLane(lane: OperationLane) {
    if (this.stopping) return false;
    if (this.running.has(lane)) {
      this.pendingWake.add(lane);
      return false;
    }
    this.running.add(lane);
    let heartbeat: NodeJS.Timeout | undefined;
    let processed = false;
    try {
      const items = await this.claim(lane);
      if (!items.length) return false;
      processed = true;
      this.idlePolls = 0;
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
      return true;
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
  /** A kind must opt into its exact execution protocol; there is no destructive fallback. */
  private readonly handlers: OperationHandlers = {
    METADATA_COMMAND: {
      protocol: 'METADATA',
      apply: (tx, items) => this.applyLibraryCommands(tx, items),
    },
    BACKGROUND_COMMAND: {
      protocol: 'COMMAND',
      execute: (items) => this.executeLibraryCommands(items),
    },
    SEND: { protocol: 'TRANSFER', execute: (items) => this.executeSend(items) },
    TRASH: { protocol: 'METADATA', apply: (tx, batch) => this.applyTrashMetadata(tx, batch) },
    RESTORE: { protocol: 'METADATA', apply: (tx, batch) => this.applyTrashMetadata(tx, batch) },
    EMPTY_TRASH: { protocol: 'CUTOFF', execute: (items) => this.executeEmptyTrash(items) },
    DUPLICATE_SCAN: { protocol: 'SCAN', execute: (items) => this.executeScan(items) },
    DUPLICATE_CLEANUP: {
      protocol: 'METADATA',
      apply: async (tx, batch) => {
        if (!this.duplicates) throw new Error('Duplicate executor is unavailable');
        await this.duplicates.applyCleanupBatch(tx, batch);
      },
    },
  };
  private async execute(items: ClaimedItem[]) {
    const item = items[0]!;
    const { operation } = item;
    try {
      if (
        !assetOperationProtocol(operation.kind) ||
        items.some((entry) => !assetOperationProtocol(entry.operation.kind))
      )
        throw new OperationAccessError('UNSUPPORTED_OPERATION_KIND');
      const handler = this.handlers[operation.kind as AssetOperationKind];
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
      if (handler.protocol === 'METADATA') {
        // The runtime kind guard is the boundary from persisted strings to the closed protocol.
        const metadata = handler as MetadataHandler<MetadataOperationKind>;
        await this.publishMetadataBatch(items, (tx) =>
          metadata.apply(tx, items as AuthorizedBatch<MetadataOperationKind>),
        );
      } else {
        await handler.execute(items);
      }
    } catch (error) {
      if (
        operation.kind === 'METADATA_COMMAND' &&
        items.length === 1 &&
        item.assetIds.length > 1 &&
        (error instanceof NotFoundException ||
          error instanceof ConflictException ||
          (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028'))
      ) {
        try {
          await this.splitLibraryCommand(item);
        } catch (splitError) {
          await this.failItems(items, splitError);
        }
        return;
      }
      if (
        items.length > 1 &&
        (error instanceof NotFoundException ||
          error instanceof ConflictException ||
          (assetOperationProtocol(operation.kind)?.execution === 'METADATA' &&
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2028'))
      ) {
        // The fast path was rolled back. Preserve unaffected items and exact conflicts.
        for (const entry of items) await this.execute([entry]);
        return;
      }
      await this.failItems(items, error);
    }
  }
  private async executeScan(items: ClaimedItem[]) {
    const operation = items[0]!.operation;
    if (!this.duplicates) throw new Error('Duplicate executor is unavailable');
    await this.prisma.$transaction((tx) => this.assertActor(tx, operation, items));
    for (const entry of items)
      await this.duplicates.executeScan(entry, (tx) => this.assertActor(tx, operation, [entry]));
  }
  private async executeEmptyTrash(items: ClaimedItem[]) {
    const operation = items[0]!.operation;
    const beforeWrite = (tx: Prisma.TransactionClient) => this.assertActor(tx, operation, items);
    await this.prisma.$transaction(beforeWrite);
    const result = await this.eagle.emptyTrashBatch(
      operation.ownerId,
      operation.isPrivate,
      operation.createdAt,
      beforeWrite,
    );
    await this.prisma.eagleAssetOperationItem.updateMany({
      where: { libraryMode: this.libraryMode, ...this.leaseWhere(items) },
      // purgeAfter is the durable checkpoint. An empty bounded step proves the cutoff is drained.
      data: { status: result.affectedAssetCount ? 'PENDING' : 'COMPLETED', leaseUntil: null },
    });
  }
  private async executeSend(items: ClaimedItem[]) {
    const operation = items[0]!.operation;
    // The transfer journal owns replay; completed transfers never perform new writes.
    const published = new Set<string>();
    const requests = items.map((entry) => {
      const entrySnapshots = entry.snapshots as unknown as Snapshot[];
      return {
        input: { assetIds: entry.assetIds, operationId: entry.id },
        expected: new Map(entrySnapshots.map((row) => [row.id, row])),
        guard: {
          beforePublish: (tx: Prisma.TransactionClient) => this.assertActor(tx, operation, [entry]),
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
  }
  private async applyTrashMetadata(
    tx: Prisma.TransactionClient,
    items: AuthorizedBatch<'TRASH' | 'RESTORE'>,
  ): Promise<'SKIPPED' | void> {
    const operation = items[0]!.operation;
    const snapshots = items.flatMap((entry) => entry.snapshots as Snapshot[]);
    const assetIds = items.flatMap((entry) => entry.assetIds);
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
      return 'SKIPPED';
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
  }
  /** One lifecycle for metadata commands; handlers supply only their domain mutation. */
  private async publishMetadataBatch(
    items: ClaimedItem[],
    mutate: (
      tx: Prisma.TransactionClient,
    ) => Promise<'SKIPPED' | void | { privacyChanged?: boolean }>,
  ) {
    const operation = items[0]!.operation;
    if (
      items.some(
        (item) =>
          item.ownerId !== operation.ownerId ||
          item.libraryMode !== this.libraryMode ||
          item.operationId !== operation.id ||
          item.operation.id !== operation.id ||
          item.operation.kind !== operation.kind,
      )
    )
      throw new ConflictException('批次作用域不一致。');
    await this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, operation.ownerId, this.libraryMode);
        await this.assertActor(tx, operation, items);
        const outcome = await mutate(tx);
        if (outcome && typeof outcome === 'object' && outcome.privacyChanged)
          await tx.eagleAssetOperation.update({
            where: {
              id: operation.id,
              ownerId: operation.ownerId,
              libraryMode: this.libraryMode,
            },
            data: { privacyChanged: true },
          });
        // Lock waits and business writes can outlive a grant or lease. Publish all facts together.
        await this.assertActor(tx, operation, items);
        const result = await tx.eagleAssetOperationItem.updateMany({
          where: {
            libraryMode: this.libraryMode,
            ...this.leaseWhere(items),
            leaseUntil: { gt: new Date() },
          },
          data: {
            status: outcome === 'SKIPPED' ? 'SKIPPED' : 'COMPLETED',
            leaseUntil: null,
          },
        });
        if (result.count !== items.length) throw new OperationAccessError('LEASE_LOST');
      },
      { timeout: METADATA_TRANSACTION_TIMEOUT_MS },
    );
  }
  private async failItems(items: ClaimedItem[], error: unknown) {
    const { operation } = items[0]!;
    const libraryModeIdentity = { libraryMode: this.libraryMode, ...this.leaseWhere(items) };
    if (error instanceof OperationCancelledError) {
      await this.prisma.eagleAssetOperationItem.updateMany({
        where: libraryModeIdentity,
        data: { status: 'CANCELLED', errorCode: null, leaseUntil: null },
      });
      return;
    }
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
            : (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') ||
                (error instanceof ServiceUnavailableException &&
                  typeof error.getResponse() === 'object' &&
                  (error.getResponse() as { code?: string }).code === 'EMPTY_TRASH_BUSY')
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
    // Unknown persisted kinds fail closed without opening a resource transaction.
    if (code === 'UNSUPPORTED_OPERATION_KIND') {
      await this.prisma.eagleAssetOperationItem.updateMany({
        where: { ...libraryModeIdentity },
        data: { status: 'FAILED', errorCode: code, leaseUntil: null },
      });
      return;
    }
    await this.prisma.$transaction(
      async (transaction) => {
        const failed = await transaction.eagleAssetOperationItem.updateMany({
          where: { ...libraryModeIdentity },
          data: { status: 'FAILED', errorCode: code, leaseUntil: null },
        });
        if (code === 'AUTH_REQUIRED' || code === 'PRIVATE_LOCKED') {
          await transaction.eagleAssetOperationItem.updateMany({
            where: {
              operationId: operation.id,
              ownerId: operation.ownerId,
              libraryMode: this.libraryMode,
              status: 'PENDING',
            },
            data: { status: 'FAILED', errorCode: code },
          });
          await this.recomputeErrorCounts(transaction, operation);
        } else if (failed.count === items.length) {
          await this.addErrorWeight(
            transaction,
            operation,
            code,
            items.reduce((sum, item) => sum + item.weight, 0),
          );
        } else {
          await this.recomputeErrorCounts(transaction, operation);
        }
      },
      { timeout: METADATA_TRANSACTION_TIMEOUT_MS },
    );
  }

  private async addErrorWeight(
    client: Prisma.TransactionClient | PrismaService,
    operation: Pick<EagleAssetOperation, 'id' | 'ownerId'>,
    code: string,
    weight: number,
  ) {
    if (weight <= 0) return;
    await client.$executeRaw(Prisma.sql`
      UPDATE "EagleAssetOperation"
      SET "errorCounts" = jsonb_set(
        "errorCounts",
        ARRAY[${code}]::text[],
        to_jsonb(COALESCE(("errorCounts"->>${code})::int, 0) + ${weight})
      )
      WHERE "id" = ${operation.id}
        AND "ownerId" = ${operation.ownerId}
        AND "libraryMode" = ${this.libraryMode}::"LibraryMode"
    `);
  }

  private async recomputeErrorCounts(
    client: Prisma.TransactionClient | PrismaService,
    operation: Pick<EagleAssetOperation, 'id' | 'ownerId'>,
  ) {
    await client.$executeRaw(Prisma.sql`
      UPDATE "EagleAssetOperation" o
      SET "errorCounts" = COALESCE((
        SELECT jsonb_object_agg("errorCode", weight)
        FROM (
          SELECT "errorCode", sum("weight")::int AS weight
          FROM "EagleAssetOperationItem"
          WHERE "operationId" = o."id"
            AND "ownerId" = o."ownerId"
            AND "libraryMode" = o."libraryMode"
            AND "status" = 'FAILED'
            AND "errorCode" IS NOT NULL
          GROUP BY "errorCode"
        ) x
      ), '{}'::jsonb)
      WHERE o."id" = ${operation.id}
        AND o."ownerId" = ${operation.ownerId}
        AND o."libraryMode" = ${this.libraryMode}::"LibraryMode"
    `);
  }
}
