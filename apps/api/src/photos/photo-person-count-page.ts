import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
export async function readUnnamedPeoplePage(
  tx: Prisma.TransactionClient,
  ownerId: string,
  includePrivate: boolean,
  after?: string,
) {
  let cursor: { id: string; photos: number } | undefined;
  if (after) {
    try {
      const raw: unknown = JSON.parse(Buffer.from(after, 'base64url').toString());
      if (!raw || typeof raw !== 'object') throw Error();
      const v = raw as Record<string, unknown>;
      if (
        v.version !== 1 ||
        v.ownerId !== ownerId ||
        v.includePrivate !== includePrivate ||
        v.view !== 'UNNAMED' ||
        typeof v.id !== 'string' ||
        v.id.length > 80 ||
        typeof v.photos !== 'number' ||
        !Number.isSafeInteger(v.photos) ||
        v.photos < 0
      )
        throw Error();
      cursor = { id: v.id, photos: v.photos };
    } catch {
      throw new BadRequestException('人物分页游标无效。');
    }
  }
  const rows = await tx.$queryRaw<
    Array<{ id: string; photos: bigint; faceId: string | null }>
  >`WITH counts AS (
 SELECT p.id,count(DISTINCT a.id) AS photos,(array_agg(f.id ORDER BY f.confidence DESC,f.id) FILTER(WHERE a.id IS NOT NULL))[1] AS "faceId" FROM "EaglePhotoPerson" p
 LEFT JOIN "EaglePhotoFace" f ON f."personId"=p.id AND f."ownerId"=p."ownerId" AND f."libraryMode"=p."libraryMode" AND f."isCurrent"
 LEFT JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode" AND a."mediaRevision"=f."assetRevision" AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
 WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO' AND p.name IS NULL AND (${includePrivate} OR NOT p."marksAssetsPrivate")
 GROUP BY p.id HAVING count(DISTINCT a.id)>0 OR (${includePrivate} AND p."marksAssetsPrivate")
 ) SELECT id,photos,"faceId" FROM counts WHERE ${!cursor} OR photos<${cursor?.photos ?? 0} OR (photos=${cursor?.photos ?? 0} AND id>${cursor?.id ?? ''}) ORDER BY photos DESC,id LIMIT 25`;
  const page = rows.slice(0, 24);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor:
      rows.length > 24 && last
        ? Buffer.from(
            JSON.stringify({
              ownerId,
              includePrivate,
              view: 'UNNAMED',
              version: 1,
              id: last.id,
              photos: Number(last.photos),
            }),
          ).toString('base64url')
        : null,
  };
}
