import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { facePreviewSelect, serializePreview } from './photo-preview';
export const visiblePhotoAssets = (
  ownerId: string,
  includePrivate: boolean,
): Prisma.EagleAssetWhereInput => ({
  ownerId,
  libraryMode: 'PHOTO',
  deletedAt: null,
  ...(!includePrivate ? { isPrivate: false } : {}),
});
export const visiblePhotoPeople = (
  ownerId: string,
  includePrivate: boolean,
): Prisma.EaglePhotoPersonWhereInput => ({
  ownerId,
  libraryMode: 'PHOTO',
  ...(!includePrivate ? { marksAssetsPrivate: false } : {}),
  OR: [
    { faces: { some: { isCurrent: true, asset: visiblePhotoAssets(ownerId, includePrivate) } } },
    ...(includePrivate ? [{ marksAssetsPrivate: true }] : []),
  ],
});
export const personPreviewSelect = (
  ownerId: string,
  includePrivate: boolean,
  facesPerPerson = 20,
  faceIds?: string[],
) =>
  ({
    id: true,
    name: true,
    createdAt: true,
    rowVersion: true,
    marksAssetsPrivate: true,
    faces: {
      where: {
        isCurrent: true,
        asset: visiblePhotoAssets(ownerId, includePrivate),
        ...(faceIds ? { id: { in: faceIds } } : {}),
      },
      select: {
        id: true,
        box: true,
        confidence: true,
        assetId: true,
        asset: { select: facePreviewSelect },
      },
      take: facesPerPerson,
      orderBy: { confidence: 'desc' as const },
    },
  }) satisfies Prisma.EaglePhotoPersonSelect;
export type PersonPreview = Prisma.EaglePhotoPersonGetPayload<{
  select: ReturnType<typeof personPreviewSelect>;
}>;
export const serializePersonPreview = (person: PersonPreview) => ({
  ...person,
  faces: person.faces.map((face) => ({ ...face, asset: serializePreview(face.asset) })),
});
export async function requireVisiblePerson(
  tx: Pick<Prisma.TransactionClient, 'eaglePhotoPerson'>,
  ownerId: string,
  id: string,
  includePrivate: boolean,
) {
  const person = await tx.eaglePhotoPerson.findFirst({
    where: { ...visiblePhotoPeople(ownerId, includePrivate), id },
  });
  if (!person) throw new NotFoundException('人物不存在。');
  return person;
}
