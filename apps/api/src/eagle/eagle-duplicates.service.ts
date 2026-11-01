import { applyOrdinaryDuplicateCleanupBatch } from './eagle-duplicate-cleanup';
import { DATABASE_STATEMENTS, databaseBatches } from './eagle-database-batches';
import { filterDuplicateReview } from './eagle-duplicate-filters';
import { readMissingDuplicateFingerprints } from './eagle-duplicate-candidates';
import { readDuplicateReview } from './eagle-duplicate-read';
import { executeDuplicateIndex } from './eagle-duplicate-index';
import {
  digest,
  dismissalSignature,
  type Snapshot,
  type CleanupSnapshot,
  type ScanSnapshot,
  type Item,
} from './eagle-duplicate-model';
const BATCH = 16;
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DUPLICATE_GROUPING_VERSION } from '@sekereagle/library-core';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';
import { assetListInclude, serializeAssetList } from './eagle-asset-projection';
import { resolveEagleTrashTargets, setEagleTrash } from './eagle-trash';
import type {
  DuplicateActionDto,
  DuplicateIgnoreDto,
  DuplicateListDto,
  DuplicateSelectionDto,
} from './eagle-duplicates.dto';
@Injectable()
export class EagleDuplicateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode,
  ) {}
  private inLibrary(ownerId: string, includePrivate: boolean) {
    return {
      ownerId,
      libraryMode: this.libraryMode,
      deletedAt: null,
      purgeAfter: null,
      storageTransferredOut: false,
      ...(includePrivate ? {} : { isPrivate: false }),
    };
  }
  private read(tx: Prisma.TransactionClient, ownerId: string, includePrivate: boolean) {
    return readDuplicateReview(tx, ownerId, this.libraryMode, includePrivate);
  }
  async list(ownerId: string, includePrivate: boolean, input: DuplicateListDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await filterDuplicateReview(
          tx,
          await this.read(tx, ownerId, includePrivate),
          ownerId,
          this.libraryMode,
          includePrivate,
          input,
        );
        if (input.revision && input.revision !== state.revision)
          throw new ConflictException('图库已变化，请刷新查重结果。');
        const visible = state.groups.filter(
          (group) =>
            (input.showIgnored === 'true'
              ? state.ignored.has(group.signature)
              : !state.ignored.has(group.signature)) &&
            (!input.kind || input.kind === 'ALL' || input.kind === group.kind),
        );
        const cursor = Number(input.cursor ?? 0);
        if (!Number.isSafeInteger(cursor)) throw new BadRequestException('分页位置无效。');
        const groups = visible.slice(cursor, cursor + 24);
        const previews = await tx.eagleAsset.findMany({
          where: {
            ...this.inLibrary(ownerId, includePrivate),
            id: { in: groups.flatMap((group) => group.assetIds.slice(0, 4)) },
          },
          include: assetListInclude,
        });
        const previewById = new Map(previews.map((row) => [row.id, serializeAssetList(row)]));
        return {
          revision: state.revision,
          exactRevision: state.exactRevision,
          exactItems: state.groups
            .filter((g) => g.kind === 'EXACT' && !state.ignored.has(g.signature))
            .reduce((n, g) => n + g.assetIds.length - 1, 0),
          verifiedGroups: state.groups.filter((g) => !state.ignored.has(g.signature)).length,
          filteredItems: visible.reduce((n, g) => n + g.assetIds.length - 1, 0),
          verifiedItems: state.groups
            .filter((g) => !state.ignored.has(g.signature))
            .reduce((n, g) => n + g.assetIds.length - 1, 0),
          coverage: state.coverage,
          outdatedGroups: state.outdatedGroups,
          algorithmVersion: state.algorithmVersion,
          originalCheckCompleted: state.originalCheckCompleted,
          originalCheckAttempted: state.originalCheckAttempted,
          totalGroups: visible.length,
          exactGroups: state.groups.filter(
            (g) => g.kind === 'EXACT' && !state.ignored.has(g.signature),
          ).length,
          similarGroups: state.groups.filter(
            (g) => g.kind === 'SIMILAR' && !state.ignored.has(g.signature),
          ).length,
          ignoredGroups: state.groups.filter((g) => state.ignored.has(g.signature)).length,
          removableBytes: visible.reduce((n, g) => n + g.removableBytes, 0),
          nextCursor:
            cursor + groups.length < visible.length ? String(cursor + groups.length) : null,
          groups: groups.map((group) => ({
            signature: group.signature,
            kind: group.kind,
            recommendedId: group.recommendedId,
            removableBytes: group.removableBytes,
            count: group.assetIds.length,
            previews: group.assetIds.slice(0, 4).map((id) => previewById.get(id)!),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    );
  }
  async members(
    ownerId: string,
    includePrivate: boolean,
    groupSignature: string,
    cursor = 0,
    filters: DuplicateListDto = {},
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await filterDuplicateReview(
          tx,
          await this.read(tx, ownerId, includePrivate),
          ownerId,
          this.libraryMode,
          includePrivate,
          filters,
        );
        const group = state.groups.find(
          (row) =>
            row.signature === groupSignature &&
            (!filters.kind || filters.kind === 'ALL' || row.kind === filters.kind),
        );
        if (!group) throw new NotFoundException('这组结果已变化，请刷新后重试。');
        const ids = group.assetIds.slice(cursor, cursor + 24);
        const rows = await tx.eagleAsset.findMany({
          where: { ...this.inLibrary(ownerId, includePrivate), id: { in: ids } },
          include: {
            ...assetListInclude,
            annotation: { select: { description: true, sourceUrl: true } },
            editRecipe: { select: { baseAssetId: true } },
          },
        });
        const byId = new Map(rows.map((row) => [row.id, row]));
        return {
          signature: group.signature,
          kind: group.kind,
          recommendedId: group.recommendedId,
          total: group.assetIds.length,
          nextCursor:
            cursor + ids.length < group.assetIds.length ? String(cursor + ids.length) : null,
          items: ids.map((id) => {
            const row = byId.get(id)!;
            return {
              ...serializeAssetList(row),
              annotation: row.annotation,
              editedCopy: !!row.editRecipe?.baseAssetId,
              livePhoto: !!row.livePhotoIdentifier,
            };
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    );
  }
  async ignore(ownerId: string, includePrivate: boolean, input: DuplicateIgnoreDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, ownerId, this.libraryMode);
        const state = await filterDuplicateReview(
          tx,
          await this.read(tx, ownerId, includePrivate),
          ownerId,
          this.libraryMode,
          includePrivate,
          input.filters ?? {},
        );
        if (input.revision && input.revision !== state.revision)
          throw new ConflictException('图库或筛选条件已变化，请重新确认。');
        const groups = input.allFiltered
          ? state.groups.filter(
              (g) =>
                (!input.filters?.kind ||
                  input.filters.kind === 'ALL' ||
                  g.kind === input.filters.kind) &&
                (input.ignored ? !state.ignored.has(g.signature) : state.ignored.has(g.signature)),
            )
          : state.groups.filter(
              (g) =>
                g.signature === input.signature &&
                (!input.filters?.kind ||
                  input.filters.kind === 'ALL' ||
                  g.kind === input.filters.kind),
            );
        if (!groups.length && !input.allFiltered) throw new NotFoundException('查重组不存在。');
        const keys = groups.map((group) => ({
          ownerId,
          libraryMode: this.libraryMode,
          signature: dismissalSignature(ownerId, this.libraryMode, group, state.byId),
        }));
        for (const { rows: part } of databaseBatches(
          keys,
          DATABASE_STATEMENTS.duplicateIgnoreLookup,
        )) {
          if (input.ignored)
            await tx.eagleDuplicateDismissal.createMany({ data: part, skipDuplicates: true });
          else
            await tx.eagleDuplicateDismissal.deleteMany({
              where: {
                ownerId,
                libraryMode: this.libraryMode,
                signature: { in: part.map((k) => k.signature) },
              },
            });
        }
        return { ignored: input.ignored };
      },
      { timeout: 30_000 },
    );
  }
  private async existing(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    id: string,
    kind: string,
    inputIds: string[],
  ) {
    const existing = await tx.eagleAssetOperation.findUnique({
      where: { id, ownerId: principal.sub, libraryMode: this.libraryMode },
    });
    if (!existing) return null;
    if (
      existing.ownerId !== principal.sub ||
      existing.libraryMode !== this.libraryMode ||
      (existing.isPrivate && !principal.canViewPrivate)
    )
      throw new NotFoundException('操作不存在。');
    if (existing.kind !== kind || JSON.stringify(existing.inputIds) !== JSON.stringify(inputIds))
      throw new ConflictException('操作标识与选择不一致。');
    if (kind === 'DUPLICATE_CLEANUP') {
      const items = await tx.eagleAssetOperationItem.findMany({
        where: { operationId: id, ownerId: principal.sub, libraryMode: this.libraryMode },
        select: { assetIds: true, snapshots: true },
      });
      return {
        operationId: existing.id,
        assetIds: [
          ...new Set(
            items.flatMap((item) => {
              const snapshot = item.snapshots as unknown as CleanupSnapshot;
              return snapshot.resources?.map((row) => row.id) ?? item.assetIds;
            }),
          ),
        ],
      };
    }
    return { operationId: existing.id };
  }
  private async admit(
    tx: Prisma.TransactionClient,
    principal: AuthPrincipal,
    id: string,
    kind: string,
    inputIds: string[],
    isPrivate: boolean,
    items: Array<{ assetIds: string[]; snapshots: ScanSnapshot | CleanupSnapshot; weight: number }>,
  ) {
    if (!items.length) return { operationId: null };
    const privateUntil =
      isPrivate && principal.privacyVisibleUntil ? new Date(principal.privacyVisibleUntil) : null;
    if (isPrivate && (!privateUntil || privateUntil <= new Date()))
      throw new NotFoundException('私密授权已失效。');
    try {
      await tx.eagleAssetOperation.create({
        data: {
          id,
          ownerId: principal.sub,
          libraryMode: this.libraryMode,
          kind,
          inputIds,
          authVersion: principal.authVersion,
          isPrivate,
          privateUntil,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new NotFoundException('操作不存在。');
      throw error;
    }
    for (const { offset, rows: batchRows } of databaseBatches(
      items,
      DATABASE_STATEMENTS.duplicateOperationItems,
    ))
      await tx.eagleAssetOperationItem.createMany({
        data: batchRows.map((item, index) => ({
          ...item,
          snapshots: item.snapshots,
          id: randomUUID(),
          operationId: id,
          ownerId: principal.sub,
          libraryMode: this.libraryMode,
          ordinal: offset + index,
        })),
      });
    await tx.$queryRaw`SELECT pg_notify('eagle_asset_operations', ${this.libraryMode})::text`;
    if (kind === 'DUPLICATE_CLEANUP')
      return {
        operationId: id,
        assetIds: [
          ...new Set(
            items.flatMap((item) =>
              'resources' in item.snapshots
                ? item.snapshots.resources.map((row) => row.id)
                : item.assetIds,
            ),
          ),
        ],
      };
    return { operationId: id };
  }
  async scan(principal: AuthPrincipal, id: string, onlyIfUnattempted = false) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, principal.sub, this.libraryMode);
        const existing = await this.existing(tx, principal, id, 'DUPLICATE_SCAN', []);
        if (existing) return existing;
        const active = await tx.eagleAssetOperation.findFirst({
          where: {
            ownerId: principal.sub,
            libraryMode: this.libraryMode,
            kind: 'DUPLICATE_SCAN',
            isPrivate: principal.canViewPrivate,
            items: { some: { status: { in: ['PENDING', 'RUNNING'] } } },
          },
        });
        if (active) return { operationId: active.id };
        if (
          onlyIfUnattempted &&
          (await tx.eagleAssetOperationItem.findFirst({
            where: {
              ownerId: principal.sub,
              libraryMode: this.libraryMode,
              operation: { kind: 'DUPLICATE_SCAN', isPrivate: principal.canViewPrivate },
              snapshots: { path: ['version'], equals: DUPLICATE_GROUPING_VERSION },
            },
            select: { id: true },
          }))
        )
          return { operationId: null, alreadyAttempted: true };
        const missing = await readMissingDuplicateFingerprints(
          tx,
          principal.sub,
          this.libraryMode,
          principal.canViewPrivate,
        );
        const items: Array<{ assetIds: string[]; snapshots: ScanSnapshot; weight: number }> = [];
        for (let offset = 0; offset < missing.length; offset += BATCH) {
          const part = missing.slice(offset, offset + BATCH);
          items.push({
            assetIds: part.map((r) => r.id),
            snapshots: {
              kind: 'scan',
              rows: part.map(({ id, rowVersion, mediaRevision }) => ({
                id,
                rowVersion,
                mediaRevision,
              })),
            },
            weight: part.length,
          });
        }
        items.push({
          assetIds: [],
          snapshots: { kind: 'build', version: DUPLICATE_GROUPING_VERSION },
          weight: 1,
        });
        return this.admit(tx, principal, id, 'DUPLICATE_SCAN', [], principal.canViewPrivate, items);
      },
      { timeout: 45_000 },
    );
  }
  async cleanup(principal: AuthPrincipal, input: DuplicateActionDto) {
    if ((input.allExact || input.allVerified || input.signatures?.length) && !input.revision)
      throw new BadRequestException('请先确认当前查重结果。');
    const request = [
      digest(
        input.allVerified || input.signatures
          ? {
              allExact: input.allExact ?? false,
              allVerified: input.allVerified ?? false,
              revision: input.revision,
              groups: input.groups,
              signatures: input.signatures,
            }
          : { allExact: input.allExact ?? false, revision: input.revision, groups: input.groups },
      ),
    ];
    if (input.filters || input.keepOverrides)
      request[0] = digest([request[0], input.filters, input.keepOverrides]);
    return this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, principal.sub, this.libraryMode);
        const existing = await this.existing(
          tx,
          principal,
          input.operationId,
          'DUPLICATE_CLEANUP',
          request,
        );
        if (existing) return existing;
        const state = await filterDuplicateReview(
          tx,
          await this.read(tx, principal.sub, principal.canViewPrivate),
          principal.sub,
          this.libraryMode,
          principal.canViewPrivate,
          input.filters ?? {},
        );
        if (
          input.revision &&
          (input.allExact ? state.exactRevision : state.revision) !== input.revision
        )
          throw new ConflictException('图库已变化，请刷新后确认。');
        const scopedGroups = state.groups.filter(
          (g) =>
            !input.filters?.kind || input.filters.kind === 'ALL' || g.kind === input.filters.kind,
        );
        const groupBySignature = new Map(scopedGroups.map((g) => [g.signature, g]));
        const choices: DuplicateSelectionDto[] =
          input.allExact || input.allVerified
            ? scopedGroups
                .filter(
                  (g) =>
                    (input.allVerified || g.kind === 'EXACT') && !state.ignored.has(g.signature),
                )
                .map((g) => ({ signature: g.signature, keepIds: [g.recommendedId] }))
            : input.signatures
              ? input.signatures.map((signature) => {
                  const group = groupBySignature.get(signature);
                  if (!group) throw new NotFoundException('查重结果已变化。');
                  return { signature, keepIds: [group.recommendedId] };
                })
              : input.groups!;
        const choiceSignatures = new Set(choices.map((c) => c.signature));
        if (choiceSignatures.size !== choices.length)
          throw new BadRequestException('不能重复选择同一组。');
        const overrides = new Map(input.keepOverrides?.map((c) => [c.signature, c]));
        if (
          overrides.size !== (input.keepOverrides?.length ?? 0) ||
          [...overrides.values()].some(
            (c) =>
              !!c.keepIds?.length === (c.removeIds !== undefined) ||
              !choiceSignatures.has(c.signature),
          )
        )
          throw new BadRequestException('保留规则必须属于本次所选分组。');
        const plans = choices
          .map((originalChoice) => {
            const choice = overrides.get(originalChoice.signature) ?? originalChoice;
            const group = groupBySignature.get(choice.signature);
            if (!group || state.ignored.has(choice.signature))
              throw new NotFoundException('查重结果已变化。');
            if (!!choice.keepIds?.length === (choice.removeIds !== undefined))
              throw new BadRequestException('请选择保留项或清理项。');
            const memberIds = new Set(group.assetIds);
            const removed = new Set(choice.removeIds ?? []);
            if (
              removed.size !== (choice.removeIds?.length ?? 0) ||
              [...removed].some((id) => !memberIds.has(id))
            )
              throw new BadRequestException('只能清理本组内容。');
            const keep = new Set(choice.keepIds ?? group.assetIds.filter((id) => !removed.has(id)));
            if (
              !keep.size ||
              (choice.keepIds && keep.size !== choice.keepIds.length) ||
              [...keep].some((id) => !memberIds.has(id))
            )
              throw new BadRequestException('每组必须保留至少一项，且只能保留本组内容。');
            return {
              group,
              choice: { signature: choice.signature, keepIds: [...keep] },
              assetIds: group.assetIds.filter((id) => !keep.has(id)),
            };
          })
          .filter((plan) => plan.assetIds.length);
        const selectedIds = plans.flatMap((p) => p.group.assetIds);
        if (new Set(selectedIds).size !== selectedIds.length)
          throw new ConflictException('所选查重组存在重叠，请刷新后重新检查。');
        const resources = new Map<string, Snapshot>();
        // One bulk resolution per database chunk, rather than two domain reads for every duplicate group.
        for (const { rows: batchRows } of databaseBatches(
          selectedIds,
          DATABASE_STATEMENTS.duplicateTrashTargets,
        ))
          for (const row of await resolveEagleTrashTargets(
            tx,
            { ownerId: principal.sub, libraryMode: this.libraryMode },
            batchRows,
            false,
            principal.canViewPrivate,
          ))
            resources.set(row.id, {
              id: row.id,
              rowVersion: row.rowVersion,
              mediaRevision: row.mediaRevision,
            });
        const componentIds = [...resources.keys()];
        const liveById = new Map<string, string | null>(),
          motions = new Map<string, Snapshot[]>();
        for (const { rows: batchRows } of databaseBatches(
          componentIds,
          DATABASE_STATEMENTS.duplicateAssetLookup,
        )) {
          const rows = await tx.eagleAsset.findMany({
            where: {
              ...this.inLibrary(principal.sub, principal.canViewPrivate),
              id: { in: batchRows },
            },
            select: { id: true, livePhotoIdentifier: true, livePhotoRole: true },
          });
          for (const row of rows) {
            liveById.set(row.id, row.livePhotoIdentifier);
            if (row.livePhotoIdentifier && row.livePhotoRole === 'MOTION') {
              const list = motions.get(row.livePhotoIdentifier) ?? [];
              list.push(resources.get(row.id)!);
              motions.set(row.livePhotoIdentifier, list);
            }
          }
        }
        const expand = (ids: string[]) => [
          ...new Map(
            ids
              .flatMap((id) => [resources.get(id)!, ...(motions.get(liveById.get(id) ?? '') ?? [])])
              .map((row) => [row.id, row]),
          ).values(),
        ];
        const items = plans.map((plan) => ({
          assetIds: plan.assetIds,
          weight: plan.assetIds.length,
          snapshots: {
            kind: 'cleanup' as const,
            signature: plan.group.signature,
            resources: expand(plan.assetIds),
            keepers: expand(plan.choice.keepIds),
            exact: true,
            targetId: plan.choice.keepIds[0]!,
          },
        }));
        const keptIds = new Set(
          items.flatMap((item) => item.snapshots.keepers.map((row) => row.id)),
        );
        if (items.some((item) => item.snapshots.resources.some((row) => keptIds.has(row.id))))
          throw new ConflictException('这些项目共用实况组件，不能拆开清理。');
        const isPrivate = selectedIds.some((id) => state.byId.get(id)!.isPrivate);
        return this.admit(
          tx,
          principal,
          input.operationId,
          'DUPLICATE_CLEANUP',
          request,
          isPrivate,
          items,
        );
      },
      { timeout: 45_000 },
    );
  }
  async executeScan(item: Item, assertActor: (tx: Prisma.TransactionClient) => Promise<void>) {
    return executeDuplicateIndex(this.prisma, this.storage, this.libraryMode, item, assertActor);
  }
  /** Business rules only; the operation executor owns the transaction, actor, lease and receipts. */
  async applyCleanupBatch(tx: Prisma.TransactionClient, items: Item[]) {
    if (
      items.length > 1 &&
      (await applyOrdinaryDuplicateCleanupBatch(
        tx,
        { ownerId: items[0]!.ownerId, libraryMode: this.libraryMode },
        items,
      ))
    )
      return;
    for (const item of items) await this.executeCleanupItem(tx, item);
  }
  private async executeCleanupItem(tx: Prisma.TransactionClient, item: Item) {
    const snapshot = item.snapshots as unknown as CleanupSnapshot;
    const expected = [...snapshot.resources, ...snapshot.keepers],
      ids = expected.map((r) => r.id).sort();
    await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${item.ownerId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    const rows: Array<Snapshot & { rating: number | null }> = [];
    for (const { rows: batchRows } of databaseBatches(
      ids,
      DATABASE_STATEMENTS.duplicateAssetLookup,
    ))
      rows.push(
        ...(await tx.eagleAsset.findMany({
          where: {
            ...this.inLibrary(item.ownerId, item.operation.isPrivate),
            id: { in: batchRows },
          },
          select: { id: true, rowVersion: true, mediaRevision: true, rating: true },
        })),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (
      rows.length !== expected.length ||
      expected.some((row) => {
        const current = byId.get(row.id);
        return (
          !current ||
          current.rowVersion !== row.rowVersion ||
          current.mediaRevision !== row.mediaRevision
        );
      })
    )
      throw new ConflictException('保留项或清理项已变化，请重新检查。');
    const currentIds = new Set<string>();
    for (const { rows: batchRows } of databaseBatches(
      item.assetIds,
      DATABASE_STATEMENTS.duplicateTrashTargets,
    ))
      for (const row of await resolveEagleTrashTargets(
        tx,
        { ownerId: item.ownerId, libraryMode: this.libraryMode },
        batchRows,
        false,
        item.operation.isPrivate,
      ))
        currentIds.add(row.id);
    const frozenIds = new Set(snapshot.resources.map((row) => row.id));
    if (currentIds.size !== frozenIds.size || [...currentIds].some((id) => !frozenIds.has(id)))
      throw new ConflictException('实况照片组件已变化。');
    if (snapshot.exact) {
      const target = snapshot.targetId;
      const tagIds = new Set<string>();
      for (const { rows: batchRows } of databaseBatches(
        item.assetIds,
        DATABASE_STATEMENTS.duplicateTagLookup,
      ))
        for (const row of await tx.eagleAssetManualTag.findMany({
          where: {
            ownerId: item.ownerId,
            libraryMode: this.libraryMode,
            assetId: { in: batchRows },
          },
          select: { tagId: true },
        }))
          tagIds.add(row.tagId);
      const tags = [...tagIds];
      for (const { rows: batchRows } of databaseBatches(
        tags,
        DATABASE_STATEMENTS.duplicateTagInsert,
      ))
        await tx.eagleAssetManualTag.createMany({
          data: batchRows.map((tagId) => ({
            ownerId: item.ownerId,
            libraryMode: this.libraryMode,
            assetId: target,
            tagId,
            assignedByUser: true,
            assignmentProvenance: 'USER_ASSIGNED',
          })),
          skipDuplicates: true,
        });
      await tx.eagleAsset.update({
        where: { id: target, ownerId: item.ownerId, libraryMode: this.libraryMode },
        data: {
          rating: rows.reduce((maximum, row) => Math.max(maximum, row.rating ?? 0), 0) || null,
          rowVersion: { increment: 1 },
        },
      });
      await syncAssetPrivacy(tx, item.ownerId, [target], this.libraryMode);
    }
    for (const { rows: part } of databaseBatches(
      item.assetIds,
      DATABASE_STATEMENTS.duplicateTrashTargets,
    )) {
      // Earlier chunks may change ambiguous live pairing; never expand beyond the reviewed snapshot.
      const current = await resolveEagleTrashTargets(
        tx,
        { ownerId: item.ownerId, libraryMode: this.libraryMode },
        part,
        false,
        item.operation.isPrivate,
      );
      if (current.some((row) => !frozenIds.has(row.id)))
        throw new ConflictException('实况照片组件已变化。');
      await setEagleTrash(
        tx,
        { ownerId: item.ownerId, libraryMode: this.libraryMode },
        part,
        false,
        item.operation.isPrivate,
      );
    }
  }
}
