import { NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { LibraryIdentity } from './library-mode';
import { encodeEagleAssetCursor } from './eagle-cursor';

/** Seek twenty preceding neighbors using the same date/id order as the normal list. */
export async function locateEagleAsset(
  db: Pick<PrismaClient, 'eagleAsset'>,
  scope: LibraryIdentity,
  assetId: string,
  includePrivate: boolean,
) {
  const where = { ...scope, deletedAt: null, ...(includePrivate ? {} : { isPrivate: false }) };
  const target = await db.eagleAsset.findFirst({
    where: { ...where, id: assetId },
    select: { id: true, chronologicalAt: true, libraryAddedAt: true },
  });
  if (!target) throw new NotFoundException('素材不存在。');
  const field = scope.libraryMode === 'PHOTO' ? 'chronologicalAt' : 'libraryAddedAt';
  const preceding = await db.eagleAsset.findMany({
    where: {
      ...where,
      OR: [{ [field]: { gt: target[field] } }, { [field]: target[field], id: { gt: target.id } }],
    },
    select: { id: true, chronologicalAt: true, libraryAddedAt: true },
    orderBy: [{ [field]: 'asc' }, { id: 'asc' }],
    take: 21,
  });
  const boundary = preceding[20];
  return {
    assetId: target.id,
    cursor: boundary
      ? encodeEagleAssetCursor({ id: boundary.id, libraryAddedAt: boundary[field] }, scope)
      : null,
  };
}
