import { readMissingDuplicateFingerprints } from './eagle-duplicate-candidates';
import { readDuplicateReview } from './eagle-duplicate-read';
import { executeDuplicateIndex, completeDuplicateItem } from './eagle-duplicate-index';
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
  Optional,
} from '@nestjs/common';
import { Prisma, type LibraryMode } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import type { AuthPrincipal } from '../auth/auth.types';
import { LIBRARY_MODE } from './library-mode';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from './eagle-privacy.service';
import { assetListInclude, serializeAssetList } from './eagle.service';
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
    @Optional() @Inject(LIBRARY_MODE) private readonly libraryMode: LibraryMode = 'MATERIAL',
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
        const state = await this.read(tx, ownerId, includePrivate);
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
            id: { in: groups.flatMap((group) => group.assetIds.slice(0, 2)) },
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
          coverage: state.coverage,
          outdatedGroups: state.outdatedGroups,
          algorithmVersion: state.algorithmVersion,
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
            previews: group.assetIds.slice(0, 2).map((id) => previewById.get(id)!),
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
    );
  }
  async members(ownerId: string, includePrivate: boolean, groupSignature: string, cursor = 0) {
    return this.prisma.$transaction(
      async (tx) => {
        const state = await this.read(tx, ownerId, includePrivate);
        const group = state.groups.find((row) => row.signature === groupSignature);
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
        const state = await this.read(tx, ownerId, includePrivate);
        const group = state.groups.find((row) => row.signature === input.signature);
        if (!group) throw new NotFoundException('查重组不存在。');
        const key = {
          ownerId,
          libraryMode: this.libraryMode,
          signature: dismissalSignature(ownerId, this.libraryMode, group, state.byId),
        };
        if (input.ignored)
          await tx.eagleDuplicateDismissal.upsert({
            where: { ownerId_libraryMode_signature: key },
            create: key,
            update: {},
          });
        else
          await tx.eagleDuplicateDismissal.deleteMany({
            where: { ownerId, libraryMode: this.libraryMode, signature: key.signature },
          });
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
    for (let offset = 0; offset < items.length; offset += 500)
      await tx.eagleAssetOperationItem.createMany({
        data: items.slice(offset, offset + 500).map((item, index) => ({
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
  async scan(principal: AuthPrincipal, id: string) {
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
        items.push({ assetIds: [], snapshots: { kind: 'build' }, weight: 1 });
        return this.admit(tx, principal, id, 'DUPLICATE_SCAN', [], principal.canViewPrivate, items);
      },
      { timeout: 45_000 },
    );
  }
  async cleanup(principal: AuthPrincipal, input: DuplicateActionDto) {
    const request = [
      digest({ allExact: input.allExact ?? false, revision: input.revision, groups: input.groups }),
    ];
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
        const state = await this.read(tx, principal.sub, principal.canViewPrivate);
        if (
          input.revision &&
          (input.allExact ? state.exactRevision : state.revision) !== input.revision
        )
          throw new ConflictException('图库已变化，请刷新后确认。');
        const choices: DuplicateSelectionDto[] = input.allExact
          ? state.groups
              .filter((g) => g.kind === 'EXACT' && !state.ignored.has(g.signature))
              .map((g) => ({ signature: g.signature, keepIds: [g.recommendedId] }))
          : input.groups!;
        if (new Set(choices.map((c) => c.signature)).size !== choices.length)
          throw new BadRequestException('不能重复选择同一组。');
        const plans = choices
          .map((choice) => {
            const group = state.groups.find((g) => g.signature === choice.signature);
            if (!group || state.ignored.has(choice.signature))
              throw new NotFoundException('查重结果已变化。');
            if (!!choice.keepIds?.length === !!choice.removeIds?.length)
              throw new BadRequestException('请选择保留项或清理项。');
            const removed = new Set(choice.removeIds ?? []);
            if (
              removed.size !== (choice.removeIds?.length ?? 0) ||
              [...removed].some((id) => !group.assetIds.includes(id))
            )
              throw new BadRequestException('只能清理本组内容。');
            const keep = new Set(choice.keepIds ?? group.assetIds.filter((id) => !removed.has(id)));
            if (
              !keep.size ||
              (choice.keepIds && keep.size !== choice.keepIds.length) ||
              [...keep].some((id) => !group.assetIds.includes(id))
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
        for (let offset = 0; offset < selectedIds.length; offset += 500)
          for (const row of await resolveEagleTrashTargets(
            tx,
            { ownerId: principal.sub, libraryMode: this.libraryMode },
            selectedIds.slice(offset, offset + 500),
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
        for (let offset = 0; offset < componentIds.length; offset += 500) {
          const rows = await tx.eagleAsset.findMany({
            where: {
              ...this.inLibrary(principal.sub, principal.canViewPrivate),
              id: { in: componentIds.slice(offset, offset + 500) },
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
            exact: plan.group.kind === 'EXACT',
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
  async execute(item: Item, assertActor: (tx: Prisma.TransactionClient) => Promise<void>) {
    if (item.operation.kind === 'DUPLICATE_SCAN')
      return executeDuplicateIndex(this.prisma, this.storage, this.libraryMode, item, assertActor);
    const snapshot = item.snapshots as unknown as CleanupSnapshot;
    await this.prisma.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, item.ownerId, this.libraryMode);
        await assertActor(tx);
        const expected = [...snapshot.resources, ...snapshot.keepers],
          ids = expected.map((r) => r.id).sort();
        await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${item.ownerId} AND "libraryMode"=${this.libraryMode}::"LibraryMode" AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
        const rows: Array<Snapshot & { rating: number | null }> = [];
        for (let offset = 0; offset < ids.length; offset += 500)
          rows.push(
            ...(await tx.eagleAsset.findMany({
              where: {
                ...this.inLibrary(item.ownerId, item.operation.isPrivate),
                id: { in: ids.slice(offset, offset + 500) },
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
        for (let offset = 0; offset < item.assetIds.length; offset += 500)
          for (const row of await resolveEagleTrashTargets(
            tx,
            { ownerId: item.ownerId, libraryMode: this.libraryMode },
            item.assetIds.slice(offset, offset + 500),
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
          for (let offset = 0; offset < item.assetIds.length; offset += 500)
            for (const row of await tx.eagleAssetManualTag.findMany({
              where: {
                ownerId: item.ownerId,
                libraryMode: this.libraryMode,
                assetId: { in: item.assetIds.slice(offset, offset + 500) },
              },
              select: { tagId: true },
            }))
              tagIds.add(row.tagId);
          const tags = [...tagIds];
          for (let offset = 0; offset < tags.length; offset += 500)
            await tx.eagleAssetManualTag.createMany({
              data: tags.slice(offset, offset + 500).map((tagId) => ({
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
        for (let offset = 0; offset < item.assetIds.length; offset += 500) {
          const part = item.assetIds.slice(offset, offset + 500);
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
        await assertActor(tx);
        await completeDuplicateItem(tx, item, this.libraryMode);
      },
      { timeout: 45_000 },
    );
  }
}
