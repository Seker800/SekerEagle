import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  RequestTimeoutException,
} from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { assetOperationProtocol, type AssetOperationSummary } from '@sekereagle/library-core';
import type { AuthPrincipal } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { EnqueueAssetOperationDto } from './eagle-asset-operations.dto';
import { databaseBatches, databaseBatchSize, DATABASE_STATEMENTS } from './eagle-database-batches';
import {
  canonicalLibraryCommand,
  LibraryCommandRegistry,
  libraryCommandPayload,
  type LibraryCommandContext,
  type LibraryCommandInput,
} from './eagle-library-command';
import { lockOperationPublication } from './eagle-operation-cancellation';
import { OPERATION_ADMISSION_TIMEOUT_MS } from './eagle-operation-settings';
import { resolveEagleTrashTargets } from './eagle-trash';
import { LIBRARY_MODE } from './library-mode';
import { LibraryOperationQueryService } from './library-operation-query.service';
import type { Snapshot } from './library-operation-types';

const ADMISSION_BATCH_SIZE = databaseBatchSize(DATABASE_STATEMENTS.operationItems);

@Injectable()
export class LibraryOperationAdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: LibraryOperationQueryService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
    @Optional() private readonly commands?: LibraryCommandRegistry,
  ) {}

  /** Persist compensation before returning. The independent executor waits for running source work. */
  async undo(principal: AuthPrincipal, id: string, operationId: string) {
    return this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-admission:${principal.sub}:${this.libraryMode}:${operationId}`}, 0))::text`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-undo:${principal.sub}:${this.libraryMode}:${id}`}, 0))::text`;
          const source = await this.query.owned(tx, id, principal.sub, principal.canViewPrivate);
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
            return this.query.summarize(
              await this.query.owned(tx, operationId, principal.sub, principal.canViewPrivate),
            );
          }
          const priorUndo = await tx.eagleAssetOperation.findFirst({
            where: {
              ...this.query.libraryModeWhere(principal.sub, principal.canViewPrivate),
              kind: 'RESTORE',
              undoOfId: id,
            },
          });
          if (priorUndo)
            return this.query.summarize(
              await this.query.owned(tx, priorUndo.id, principal.sub, principal.canViewPrivate),
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
          return this.query.summary(operation);
        },
        { timeout: OPERATION_ADMISSION_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('操作不存在。');
        throw error;
      });
  }
  /** Accept an immutable command without waiting for any domain publication lock. */
  async enqueueCommand(
    principal: AuthPrincipal,
    input: LibraryCommandInput,
  ): Promise<AssetOperationSummary> {
    if (!this.commands) throw new BadRequestException('后台操作未配置。');
    const definition = this.commands.get(input.type);
    const operationId = input.operationId ?? randomUUID();
    const assetIds = [...new Set(input.assetIds ?? [])].sort();
    const payload = libraryCommandPayload(input.payload);
    const context: LibraryCommandContext = {
      ownerId: principal.sub,
      operationId,
      libraryMode: this.libraryMode,
      includePrivate: principal.canViewPrivate,
      beforePublish: () => Promise.reject(new Error('Admission cannot publish domain writes')),
    };
    const kind = definition.protocol === 'METADATA' ? 'METADATA_COMMAND' : 'BACKGROUND_COMMAND';
    // Store a compact canonical digest with the intent, including all parameters.
    const intent = createHash('sha256')
      .update(canonicalLibraryCommand({ type: input.type, payload, assetIds }))
      .digest('hex');
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`asset-operation-admission:${principal.sub}:${this.libraryMode}:${operationId}`}, 0))::text`;
          const existing = await tx.eagleAssetOperation.findUnique({
            where: { id: operationId, ownerId: principal.sub, libraryMode: this.libraryMode },
          });
          if (existing) {
            if (existing.isPrivate && !principal.canViewPrivate)
              throw new NotFoundException('操作不存在。');
            if (
              existing.kind !== kind ||
              canonicalLibraryCommand(existing.inputIds) !==
                canonicalLibraryCommand([intent, input.type])
            )
              throw new ConflictException('操作标识与请求不一致。');
            return this.query.summarize(existing);
          }
          const resources = new Map<
            string,
            { id: string; mediaRevision: number; isPrivate: boolean }
          >();
          for (const { rows: ids } of databaseBatches(
            assetIds,
            DATABASE_STATEMENTS.operationAssetLookup,
          )) {
            const rows = await tx.eagleAsset.findMany({
              where: {
                ownerId: principal.sub,
                libraryMode: this.libraryMode,
                id: { in: ids },
                deletedAt: null,
                purgeAfter: null,
                ...(principal.canViewPrivate ? {} : { isPrivate: false }),
              },
              select: { id: true, mediaRevision: true, isPrivate: true },
            });
            if (rows.length !== ids.length) throw new NotFoundException('一个或多个资源不存在。');
            rows.forEach((row) => resources.set(row.id, row));
          }
          // Public-only selections stay public even when the caller can also view private items.
          // Commands without asset membership keep the conservative principal-based scope.
          const isPrivate =
            principal.canViewPrivate &&
            (resources.size === 0 ||
              [...resources.values()].some((resource) => resource.isPrivate));
          const privateUntil =
            isPrivate && principal.privacyVisibleUntil
              ? new Date(principal.privacyVisibleUntil)
              : null;
          if (isPrivate && (!privateUntil || privateUntil <= new Date()))
            throw new NotFoundException('私密授权已失效。');
          await definition.admit?.(context, payload, assetIds);
          const prepared = (await definition.prepare?.(context, payload, assetIds, tx)) ?? payload;
          const parts = definition.partition?.(prepared, assetIds) ?? [
            { payload: prepared, assetIds },
          ];
          if (!parts.length) throw new BadRequestException('请选择要处理的资源。');
          // Domain partitions share the exact immutable object when their parameters
          // are common. Do not repeatedly stringify a potentially large LUT per resource.
          const sharedPayload = parts.every((part) => part.payload === prepared);
          const operation = await tx.eagleAssetOperation.create({
            data: {
              id: operationId,
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              kind,
              inputIds: [intent, input.type],
              ...(sharedPayload ? { commandPayload: prepared } : {}),
              authVersion: principal.authVersion,
              isPrivate,
              privateUntil,
            },
          });
          const items = parts.map((part, ordinal) => ({
            id: randomUUID(),
            operationId,
            ownerId: principal.sub,
            libraryMode: this.libraryMode,
            ordinal,
            assetIds: part.assetIds,
            snapshots: libraryCommandPayload({
              version: 1,
              type: input.type,
              payload: sharedPayload ? {} : part.payload,
              ...(sharedPayload ? { sharedPayload: true } : {}),
              resources: part.assetIds.map((id) => resources.get(id)),
            }),
            weight: Math.max(1, part.assetIds.length),
            status: 'PENDING',
            errorCode: null,
          }));
          for (const { rows: data } of databaseBatches(items, DATABASE_STATEMENTS.operationItems))
            await tx.eagleAssetOperationItem.createMany({ data });
          await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
          return this.query.summary({ ...operation, items });
        },
        { timeout: OPERATION_ADMISSION_TIMEOUT_MS },
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          throw new NotFoundException('操作不存在。');
        throw error;
      });
    return result;
  }

  async enqueue(principal: AuthPrincipal, input: EnqueueAssetOperationDto) {
    if (assetOperationProtocol(input.kind)?.admission !== 'DIRECT')
      throw new BadRequestException('不支持此操作，请使用对应功能入口。');
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
            return this.query.summarize(existing);
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
            for (const { rows: part } of databaseBatches(
              ids,
              DATABASE_STATEMENTS.operationAssetLookup,
            )) {
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
          for (const { rows: ids } of databaseBatches(
            activeIds,
            DATABASE_STATEMENTS.operationTrashTargets,
          )) {
            const part = await resolveEagleTrashTargets(
              tx,
              { ownerId: principal.sub, libraryMode: this.libraryMode },
              ids,
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
          for (const { rows: ids } of databaseBatches(
            resourceIds,
            DATABASE_STATEMENTS.operationAssetLookup,
          )) {
            rows.push(
              ...(await tx.eagleAsset.findMany({
                where: {
                  id: { in: ids },
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
          for (const { rows: part } of databaseBatches(
            pendingItems,
            DATABASE_STATEMENTS.operationItems,
          )) {
            await tx.eagleAssetOperationItem.createMany({
              data: part,
            });
          }
          await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
          return this.query.summary({
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
      const operation = await this.query.owned(tx, id, principal.sub, principal.canViewPrivate);
      await lockOperationPublication(
        tx,
        { operationId: operation.id, ownerId: principal.sub, libraryMode: this.libraryMode },
        true,
      );
      const privateUntil =
        operation.isPrivate && principal.privacyVisibleUntil
          ? new Date(principal.privacyVisibleUntil)
          : null;
      if (operation.isPrivate && (!privateUntil || privateUntil <= new Date()))
        throw new NotFoundException('操作不存在。');
      await tx.eagleAssetOperation.update({
        where: { id: operation.id, ownerId: principal.sub, libraryMode: this.libraryMode },
        data: {
          authVersion: principal.authVersion,
          privateUntil,
          cancelRequestedAt: null,
          errorCounts: {},
        },
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
      return this.query.summarize(
        await this.query.owned(tx, id, principal.sub, principal.canViewPrivate),
      );
    });
    return result;
  }
  async cancel(principal: AuthPrincipal, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const operation = await this.query.owned(tx, id, principal.sub, principal.canViewPrivate);
      await lockOperationPublication(
        tx,
        { operationId: operation.id, ownerId: principal.sub, libraryMode: this.libraryMode },
        true,
      );
      await tx.eagleAssetOperation.update({
        where: { id: operation.id, ownerId: principal.sub, libraryMode: this.libraryMode },
        data: { cancelRequestedAt: new Date() },
      });
      await tx.eagleAssetOperationItem.updateMany({
        where: {
          operationId: operation.id,
          ownerId: principal.sub,
          libraryMode: this.libraryMode,
          status: 'PENDING',
        },
        data: { status: 'CANCELLED', leaseUntil: null },
      });
      return this.query.summarize(
        await this.query.owned(tx, id, principal.sub, principal.canViewPrivate),
      );
    });
  }
}
