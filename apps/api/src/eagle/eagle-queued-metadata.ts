import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LibraryCommandContext } from './eagle-library-command';
import { libraryCommandPayload } from './eagle-library-command';
import type { BatchUpdateEagleAssetsDto } from './eagle.dto';
import type { EagleService } from './eagle.service';
import { databaseBatches, DATABASE_STATEMENTS } from './eagle-database-batches';
type QueueBase = { assetId: string; rowVersion: number; predecessors: string[] };
type QueuedUpdate = BatchUpdateEagleAssetsDto & { queueBase?: QueueBase[] };

/** Capture only already accepted predecessors; a later independent write cannot authorize rebasing. */
export async function prepareQueuedMetadata(
  tx: Prisma.TransactionClient,
  context: LibraryCommandContext,
  payload: Prisma.InputJsonObject,
  assetIds: string[],
) {
  const input = payload as unknown as BatchUpdateEagleAssetsDto;
  const expected = new Map(input.assets.map((asset) => [asset.assetId, asset.rowVersion]));
  const queueBase: QueueBase[] = [];
  for (const { rows: ids } of databaseBatches(assetIds, DATABASE_STATEMENTS.operationAssetLookup)) {
    const [current, queued] = await Promise.all([
      tx.eagleAsset.findMany({
        where: {
          ownerId: context.ownerId,
          libraryMode: context.libraryMode,
          id: { in: ids },
          deletedAt: null,
          ...(!context.includePrivate ? { isPrivate: false } : {}),
        },
        select: { id: true, rowVersion: true },
      }),
      tx.eagleAssetOperationItem.findMany({
        where: {
          ownerId: context.ownerId,
          libraryMode: context.libraryMode,
          status: { in: ['PENDING', 'RUNNING'] },
          operation: { kind: 'METADATA_COMMAND' },
          snapshots: { path: ['type'], equals: 'ASSET_UPDATE' },
          assetIds: { hasSome: ids },
        },
        select: { operationId: true, assetIds: true, snapshots: true, status: true },
      }),
    ]);
    const explicit: typeof queued = [];
    for (const { rows: priorIds } of databaseBatches(
      input.predecessorOperationIds ?? [],
      DATABASE_STATEMENTS.operationAssetLookup,
    ))
      explicit.push(
        ...(await tx.eagleAssetOperationItem.findMany({
          where: {
            ownerId: context.ownerId,
            libraryMode: context.libraryMode,
            operationId: { in: priorIds },
            operation: { kind: 'METADATA_COMMAND' },
            status: { in: ['PENDING', 'RUNNING', 'COMPLETED'] },
            snapshots: { path: ['type'], equals: 'ASSET_UPDATE' },
            assetIds: { hasSome: ids },
          },
          select: { operationId: true, assetIds: true, snapshots: true, status: true },
        })),
      );
    if (current.length !== ids.length) throw new NotFoundException('一个或多个资源不存在。');
    for (const row of current) {
      if (row.rowVersion !== expected.get(row.id)) {
        const recognized = explicit.some((item) => {
          const facts = item.snapshots as unknown as {
            payload?: QueuedUpdate;
            publishedVersions?: Array<{ assetId: string; rowVersion: number }>;
          };
          return (
            facts.payload?.assets.some(
              (asset) => asset.assetId === row.id && asset.rowVersion === expected.get(row.id),
            ) &&
            facts.publishedVersions?.some(
              (asset) => asset.assetId === row.id && asset.rowVersion === row.rowVersion,
            )
          );
        });
        if (!recognized) throw new ConflictException('资源已被其他操作更新，请刷新后重试。');
      }
      queueBase.push({
        assetId: row.id,
        rowVersion: expected.get(row.id)!,
        predecessors: [
          ...new Set(
            [...queued, ...explicit]
              .filter((item) => item.assetIds.includes(row.id))
              .map((item) => item.operationId),
          ),
        ],
      });
    }
  }
  return libraryCommandPayload({ ...input, queueBase });
}

/** Rebase solely onto exact, committed receipts from the admission snapshot. */
export async function applyQueuedMetadata(
  eagle: EagleService,
  tx: Prisma.TransactionClient,
  context: LibraryCommandContext,
  payload: Prisma.InputJsonObject,
) {
  const input = payload as unknown as QueuedUpdate;
  if (!input.queueBase) {
    await eagle.batchUpdate(context.ownerId, input, context.includePrivate, tx);
    return;
  }
  const bases = new Map(input.queueBase?.map((base) => [base.assetId, base]));
  const current = await tx.eagleAsset.findMany({
    where: {
      ownerId: context.ownerId,
      libraryMode: context.libraryMode,
      id: { in: input.assets.map((asset) => asset.assetId) },
      deletedAt: null,
      ...(!context.includePrivate ? { isPrivate: false } : {}),
    },
    select: { id: true, rowVersion: true },
  });
  const versions = new Map(current.map((row) => [row.id, row.rowVersion]));
  const changed = input.assets.filter((asset) => versions.get(asset.assetId) !== asset.rowVersion);
  const predecessors = [
    ...new Set(changed.flatMap((asset) => bases.get(asset.assetId)?.predecessors ?? [])),
  ];
  const receipts: Array<{ operationId: string; snapshots: Prisma.JsonValue }> = [];
  for (const { rows: operationIds } of databaseBatches(
    predecessors,
    DATABASE_STATEMENTS.operationAssetLookup,
  )) {
    receipts.push(
      ...(await tx.eagleAssetOperationItem.findMany({
        where: {
          ownerId: context.ownerId,
          libraryMode: context.libraryMode,
          operationId: { in: operationIds },
          status: 'COMPLETED',
          operation: { kind: 'METADATA_COMMAND' },
          snapshots: { path: ['type'], equals: 'ASSET_UPDATE' },
        },
        select: { operationId: true, snapshots: true },
      })),
    );
  }
  const rebased = input.assets.map((asset) => {
    const rowVersion = versions.get(asset.assetId);
    if (rowVersion === undefined) throw new NotFoundException('资源不可访问。');
    if (rowVersion === asset.rowVersion) return asset;
    const base = bases.get(asset.assetId);
    const recognized =
      base?.rowVersion === asset.rowVersion &&
      receipts.some((receipt) => {
        if (!base.predecessors.includes(receipt.operationId)) return false;
        const published = (
          receipt.snapshots as unknown as {
            publishedVersions?: Array<{ assetId: string; rowVersion: number }>;
          }
        ).publishedVersions;
        return published?.some(
          (row) => row.assetId === asset.assetId && row.rowVersion === rowVersion,
        );
      });
    if (!recognized) throw new ConflictException('资源已被其他操作更新，请刷新后重试。');
    return { ...asset, rowVersion };
  });
  const changes = { ...input };
  delete changes.queueBase;
  delete changes.predecessorOperationIds;
  const result = await eagle.batchUpdate(
    context.ownerId,
    { ...changes, assets: rebased },
    context.includePrivate,
    tx,
  );
  await tx.$executeRaw`UPDATE "EagleAssetOperationItem" SET snapshots=jsonb_set(snapshots,'{publishedVersions}',${JSON.stringify(result.assets)}::jsonb)
    WHERE "operationId"=${context.operationId} AND "ownerId"=${context.ownerId} AND "libraryMode"=${context.libraryMode}::"LibraryMode" AND status='RUNNING' AND "assetIds" && ${rebased.map((asset) => asset.assetId)}::text[]`;
}
