import type { Prisma, LibraryMode } from '@prisma/client';
import { inheritedPrivacyTag } from './privacy-tag';
type Source = Prisma.EagleAssetGetPayload<{
  include: {
    annotation: true;
    manualTagLinks: { include: { tag: { select: { marksAssetsPrivate: true } } } };
  };
}>;
export function editedCopyTag(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
) {
  return transaction.eagleManualTag.upsert({
    where: {
      ownerId_libraryMode_normalizedName: { ownerId, libraryMode, normalizedName: '已编辑' },
      libraryMode,
    },
    create: { ownerId, libraryMode, name: '已编辑', normalizedName: '已编辑' },
    update: {},
    select: { id: true, marksAssetsPrivate: true },
  });
}
export async function inheritEditedCopyDetails(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  copySource: Source,
  editedTag: { id: string } | null,
) {
  if (copySource.annotation)
    await transaction.eagleAssetAnnotation.create({
      data: {
        ownerId,
        libraryMode,
        assetId,
        description: copySource.annotation.description,
        sourceUrl: copySource.annotation.sourceUrl,
      },
    });
  const tagIds = new Set(copySource.manualTagLinks.map((link) => link.tagId));
  if (editedTag) tagIds.add(editedTag.id);
  if (
    copySource.isPrivate &&
    !copySource.manualTagLinks.some((link) => link.tag.marksAssetsPrivate)
  )
    tagIds.add(await inheritedPrivacyTag(transaction, ownerId, libraryMode));
  if (tagIds.size)
    await transaction.eagleAssetManualTag.createMany({
      data: [...tagIds].map((tagId) => ({
        ownerId,
        libraryMode,
        assetId,
        tagId,
        assignedByUser: true,
        assignmentProvenance: 'USER_ASSIGNED',
      })),
    });
}
