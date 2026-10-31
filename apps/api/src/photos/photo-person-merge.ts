import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { syncAssetPrivacy } from '@sekereagle/library-persistence';

export async function mergeSelectedPeople(
  tx: Prisma.TransactionClient,
  ownerId: string,
  includePrivate: boolean,
  targetId: string,
  selected: readonly { id: string; rowVersion?: number }[],
) {
  const versions = new Map(selected.map((p) => [p.id, p.rowVersion]));
  const ids = [...versions.keys()];
  if (ids.length < 2 || !versions.has(targetId))
    throw new BadRequestException('请选择要合并的人物和保留目标。');
  const people = await tx.$queryRaw<
    Array<{ id: string; rowVersion: number; marksAssetsPrivate: boolean }>
  >`
    SELECT p.id,p."rowVersion",p."marksAssetsPrivate" FROM "EaglePhotoPerson" p
    WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO' AND p.id=ANY(${ids}::text[])
      AND (${includePrivate} OR NOT p."marksAssetsPrivate")
      AND (EXISTS(SELECT 1 FROM "EaglePhotoFace" f JOIN "EagleAsset" a
        ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode"
        WHERE f."personId"=p.id AND f."ownerId"=p."ownerId" AND f."libraryMode"='PHOTO' AND f."isCurrent"
          AND f."assetRevision"=a."mediaRevision" AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate"))
        OR (${includePrivate} AND p."marksAssetsPrivate"))`;

  if (people.length !== ids.length) throw new NotFoundException('人物不存在。');
  if (people.some((p) => versions.get(p.id) !== undefined && p.rowVersion !== versions.get(p.id)))
    throw new ConflictException('人物已变化，请重新选择。');
  const sources = ids.filter((id) => id !== targetId);
  const separations = await tx.$queryRaw<Array<{ firstId: string; secondId: string }>>`
    SELECT "firstId","secondId" FROM "EaglePhotoPersonSeparation"
    WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO'
      AND ("firstId"=ANY(${sources}::text[]) OR "secondId"=ANY(${sources}::text[]))`;
  const sourceSet = new Set(sources);
  const inherited = new Map<
    string,
    { ownerId: string; libraryMode: 'PHOTO'; firstId: string; secondId: string }
  >();
  for (const row of separations) {
    const first = sourceSet.has(row.firstId) ? targetId : row.firstId;
    const second = sourceSet.has(row.secondId) ? targetId : row.secondId;
    if (first === second) continue;
    const [firstId, secondId] = [first, second].sort() as [string, string];
    inherited.set(firstId + ':' + secondId, { ownerId, libraryMode: 'PHOTO', firstId, secondId });
  }
  if (inherited.size)
    await tx.eaglePhotoPersonSeparation.createMany({
      data: [...inherited.values()],
      skipDuplicates: true,
    });
  const marksAssetsPrivate = people.some((p) => p.marksAssetsPrivate);
  const target = await tx.eaglePhotoPerson.update({
    where: { id: targetId },
    data: { marksAssetsPrivate, rowVersion: { increment: 1 } },
    select: { id: true, rowVersion: true, marksAssetsPrivate: true },
  });
  await tx.$executeRaw`UPDATE "EaglePhotoFace" SET "personId"=${targetId},"userAssigned"=true
    WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND "personId"=ANY(${sources}::text[])`;
  await tx.$executeRaw`DELETE FROM "EaglePhotoPerson" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO' AND id=ANY(${sources}::text[])`;
  if (marksAssetsPrivate && people.some((p) => !p.marksAssetsPrivate))
    await syncAssetPrivacy(tx, ownerId, undefined, 'PHOTO');
  const [count] = await tx.$queryRaw<
    Array<{ photos: bigint }>
  >`SELECT count(DISTINCT f."assetId") AS photos FROM "EaglePhotoFace" f JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode" WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."personId"=${targetId} AND f."isCurrent" AND f."assetRevision"=a."mediaRevision" AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")`;
  return { ...target, photoCount: Number(count?.photos ?? 0n), mergedIds: sources };
}
