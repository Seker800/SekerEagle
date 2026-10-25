import { randomUUID } from 'node:crypto';
import { photoCaptureMetadata } from '@sekereagle/library-core';
import type { Prisma, LibraryMode } from '@prisma/client';
export async function inheritPhotoEditedCopy(
  tx: Prisma.TransactionClient,
  scope: { ownerId: string; libraryMode: LibraryMode },
  copy: { sourceAssetId: string; assetId: string; mediaRevision: number },
) {
  if (scope.libraryMode !== 'PHOTO') throw new Error('PHOTO_REVISION_SCOPE_MISMATCH');
  const where = {
    ownerId: scope.ownerId,
    libraryMode: scope.libraryMode,
    deletedAt: null,
    purgeAfter: null,
  };
  const source = await tx.eagleAsset.findFirst({
    where: { ...where, id: copy.sourceAssetId },
    include: { photoMetadata: true },
  });
  const target = await tx.eagleAsset.findFirst({
    where: { ...where, id: copy.assetId, mediaRevision: copy.mediaRevision },
  });
  if (!source || !target) throw new Error('PHOTO_EDIT_SOURCE_UNAVAILABLE');
  await tx.eagleAsset.updateMany({
    where: { ...where, id: target.id },
    data: { chronologicalAt: source.chronologicalAt },
  });
  await tx.eaglePhotoMetadata.create({
    data: {
      ownerId: scope.ownerId,
      libraryMode: scope.libraryMode,
      assetId: target.id,
      assetRevision: copy.mediaRevision,
      processorVersion: 'photo-edit-capture-v1',
      ...(source.photoMetadata?.assetRevision === source.mediaRevision
        ? photoCaptureMetadata(source.photoMetadata)
        : {}),
      captureMetadataInherited: true,
    },
  });
  // A private edited-tag can make a formerly public image private: never bridge visibility domains.
  if (source.isPrivate !== target.isPrivate) return;
  let group = await tx.eaglePhotoGroup.findFirst({
    where: {
      ownerId: scope.ownerId,
      libraryMode: scope.libraryMode,
      dismissed: false,
      members: {
        some: { assetId: source.id },
        every: { asset: { ...where, isPrivate: target.isPrivate } },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!group)
    group = await tx.eaglePhotoGroup.create({
      data: {
        ownerId: scope.ownerId,
        libraryMode: scope.libraryMode,
        kind: 'EDITED',
        sourceKey: `edit:${source.id}:${source.mediaRevision}:${randomUUID()}`,
      },
    });
  await tx.eaglePhotoGroupMember.createMany({
    data: [source.id, target.id].map((assetId) => ({
      ownerId: scope.ownerId,
      libraryMode: scope.libraryMode,
      groupId: group.id,
      assetId,
    })),
    skipDuplicates: true,
  });
  if (!group.bestSelectedByUser)
    await tx.eaglePhotoGroup.updateMany({
      where: {
        id: group.id,
        ownerId: scope.ownerId,
        libraryMode: scope.libraryMode,
        bestSelectedByUser: false,
      },
      data: { bestAssetId: target.id },
    });
}
