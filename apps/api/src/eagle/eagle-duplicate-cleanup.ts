import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { syncAssetPrivacy } from './eagle-privacy.service';
import { DATABASE_STATEMENTS, databaseBatches } from './eagle-database-batches';
import { type CleanupSnapshot, type Item, type Snapshot } from './eagle-duplicate-model';
import type { LibraryIdentity } from './library-mode';
import { resolveEagleTrashTargets, setEagleTrash } from './eagle-trash';

/** Disjoint ordinary pictures share reads and writes. Live pairing retains its sequential protocol. */
export async function applyOrdinaryDuplicateCleanupBatch(
  tx: Prisma.TransactionClient,
  identity: LibraryIdentity,
  items: Item[],
): Promise<boolean> {
  const plans = items.map((item) => ({
    item,
    snapshot: item.snapshots as unknown as CleanupSnapshot,
  }));
  if (plans.some((plan) => !plan.snapshot.exact)) return false;
  const expected = plans.flatMap((plan) => [...plan.snapshot.resources, ...plan.snapshot.keepers]);
  const ids = expected.map((row) => row.id).sort();
  if (new Set(ids).size !== ids.length) return false;
  await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE "ownerId"=${identity.ownerId} AND "libraryMode"=${identity.libraryMode}::"LibraryMode" AND id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
  const rows: Array<Snapshot & { rating: number | null; livePhotoIdentifier: string | null }> = [];
  for (const { rows: part } of databaseBatches(ids, DATABASE_STATEMENTS.duplicateAssetLookup))
    rows.push(
      ...(await tx.eagleAsset.findMany({
        where: {
          ...identity,
          id: { in: part },
          deletedAt: null,
          purgeAfter: null,
          storageTransferredOut: false,
          ...(items[0]!.operation.isPrivate ? {} : { isPrivate: false }),
        },
        select: {
          id: true,
          rowVersion: true,
          mediaRevision: true,
          rating: true,
          livePhotoIdentifier: true,
        },
      })),
    );
  if (rows.some((row) => row.livePhotoIdentifier)) return false;
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
  const assetIds = items.flatMap((item) => item.assetIds);
  // Non-live snapshots must describe exactly their selected resources. The shared
  // resolver still checks newly discovered components in each bounded read.
  for (const { item, snapshot } of plans) {
    const selected = new Set(item.assetIds);
    if (
      selected.size !== snapshot.resources.length ||
      snapshot.resources.some((row) => !selected.has(row.id))
    )
      throw new ConflictException('实况照片组件已变化。');
  }
  for (const { rows: part } of databaseBatches(assetIds, DATABASE_STATEMENTS.duplicateTrashTargets))
    await resolveEagleTrashTargets(tx, identity, part, false, items[0]!.operation.isPrivate, [
      { assetIds: part, resourceIds: part },
    ]);
  const targets = new Map<string, string>();
  for (const { item, snapshot } of plans) {
    if (!snapshot.keepers.some((row) => row.id === snapshot.targetId))
      throw new ConflictException('保留项已变化。');
    for (const id of item.assetIds) targets.set(id, snapshot.targetId);
  }
  const links = new Map<string, Prisma.EagleAssetManualTagCreateManyInput>();
  for (const { rows: part } of databaseBatches(assetIds, DATABASE_STATEMENTS.duplicateTagLookup)) {
    for (const row of await tx.eagleAssetManualTag.findMany({
      where: { ...identity, assetId: { in: part } },
      select: { assetId: true, tagId: true },
    })) {
      const target = targets.get(row.assetId)!;
      links.set(JSON.stringify([target, row.tagId]), {
        ...identity,
        assetId: target,
        tagId: row.tagId,
        assignedByUser: true,
        assignmentProvenance: 'USER_ASSIGNED',
      });
    }
  }
  for (const { rows: part } of databaseBatches(
    [...links.values()],
    DATABASE_STATEMENTS.duplicateTagInsert,
  ))
    await tx.eagleAssetManualTag.createMany({ data: part, skipDuplicates: true });
  const ratings = plans.map(({ snapshot }) => ({
    id: snapshot.targetId,
    rating:
      [...snapshot.resources, ...snapshot.keepers].reduce(
        (maximum, row) => Math.max(maximum, byId.get(row.id)!.rating ?? 0),
        0,
      ) || null,
  }));
  for (const { rows: batch } of databaseBatches(
    ratings,
    DATABASE_STATEMENTS.duplicateRatingUpdate,
  )) {
    const changed = await tx.$executeRaw(
      Prisma.sql`UPDATE "EagleAsset" a SET rating=r.rating,"rowVersion"=a."rowVersion"+1,"updatedAt"=CURRENT_TIMESTAMP FROM (VALUES ${Prisma.join(batch.map((row) => Prisma.sql`(${row.id}::text,${row.rating}::int)`))}) AS r(id,rating) WHERE a.id=r.id AND a."ownerId"=${identity.ownerId} AND a."libraryMode"=${identity.libraryMode}::"LibraryMode"`,
    );
    if (changed !== batch.length) throw new ConflictException('保留项已变化。');
  }
  for (const { rows: part } of databaseBatches(
    ratings.map((row) => row.id),
    DATABASE_STATEMENTS.duplicateAssetLookup,
  ))
    await syncAssetPrivacy(tx, identity.ownerId, part, identity.libraryMode);
  for (const { rows: part } of databaseBatches(assetIds, DATABASE_STATEMENTS.duplicateTrashTargets))
    await setEagleTrash(tx, identity, part, false, items[0]!.operation.isPrivate);
  return true;
}
