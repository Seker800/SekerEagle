import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { LibraryIdentity } from './library-mode';
import { resolveLivePhotoMotions } from './live-photo-projection';
const privateVisibilityWhere = (includePrivate: boolean) =>
  includePrivate ? {} : { isPrivate: false };
/** Shared transaction primitive; callers may compose audit writes atomically. */
export async function setEagleTrash(
  transaction: Prisma.TransactionClient,
  identity: LibraryIdentity,
  assetIds: string[],
  restore: boolean,
  includePrivate = false,
) {
  const { ownerId, libraryMode } = identity;
  const resources = await resolveEagleTrashTargets(
    transaction,
    identity,
    assetIds,
    restore,
    includePrivate,
  );
  const resourceIds = resources.map((resource) => resource.id);
  const result = await transaction.eagleAsset.updateMany({
    where: {
      ownerId,
      id: { in: resourceIds },
      deletedAt: restore ? { not: null } : null,
      purgeAfter: restore ? null : undefined,
      ...privateVisibilityWhere(includePrivate),
      libraryMode: libraryMode,
    },
    data: {
      deletedAt: restore ? null : new Date(),
      purgeAfter: null,
      rowVersion: { increment: 1 },
    },
  });
  if (result.count !== resourceIds.length) throw new NotFoundException('一个或多个素材不存在。');
  if (restore) {
    // Only work skipped while trashed is resumed; completed durable work stays reusable.
    await transaction.eagleAssetProcessingJob.updateMany({
      where: {
        ownerId,
        libraryMode: libraryMode,
        assetId: { in: resourceIds },
        status: 'COMPLETED',
        lastError: 'ASSET_TRASHED',
        kind: { not: 'PURGE_ASSET' },
      },
      data: {
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date(),
        lockedAt: null,
        completedAt: null,
        lastError: null,
        leaseVersion: { increment: 1 },
      },
    });
  }
  return result.count;
}

/** Resolve the same logical resource set for mutation, version checks and durable audit snapshots. */
export async function resolveEagleTrashTargets(
  transaction: Prisma.TransactionClient,
  identity: LibraryIdentity,
  assetIds: string[],
  restore: boolean,
  includePrivate = false,
) {
  const { ownerId, libraryMode } = identity;
  const ids = [...new Set(assetIds)];
  if (!ids.length || ids.length !== assetIds.length)
    throw new BadRequestException('素材 ID 不能为空或重复。');
  const sources = await transaction.eagleAsset.findMany({
    where: {
      ownerId,
      libraryMode: libraryMode,
      id: { in: ids },
      deletedAt: restore ? { not: null } : null,
      purgeAfter: restore ? null : undefined,
      ...privateVisibilityWhere(includePrivate),
    },
    select: {
      id: true,
      mediaRevision: true,
      rowVersion: true,
      deletedAt: true,
      livePhotoIdentifier: true,
      livePhotoRole: true,
    },
  });
  if (sources.length !== ids.length) throw new NotFoundException('一个或多个素材不存在。');
  const motions = await resolveLivePhotoMotions(
    transaction,
    { ownerId, libraryMode: libraryMode },
    sources,
    includePrivate,
    restore,
  );
  const resourceIds = [...new Set([...ids, ...[...motions.values()].map((row) => row.assetId)])];
  return transaction.eagleAsset.findMany({
    where: { ownerId, libraryMode, id: { in: resourceIds } },
    select: { id: true, mediaRevision: true, rowVersion: true, deletedAt: true },
    orderBy: { id: 'asc' },
  });
}
