import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
export async function readPeopleCountPage(
  tx: Prisma.TransactionClient,
  ownerId: string,
  includePrivate: boolean,
  after: string | undefined,
  view: 'ALL' | 'UNNAMED',
) {
  let cursor: { id: string; photos: number; named: boolean } | undefined;
  if (after) {
    try {
      const raw: unknown = JSON.parse(Buffer.from(after, 'base64url').toString());
      if (!raw || typeof raw !== 'object') throw Error();
      const v = raw as Record<string, unknown>;
      if (
        v.version !== (view === 'ALL' ? 2 : 1) ||
        v.ownerId !== ownerId ||
        v.includePrivate !== includePrivate ||
        v.view !== view ||
        (view === 'ALL' && typeof v.named !== 'boolean') ||
        typeof v.id !== 'string' ||
        v.id.length > 80 ||
        typeof v.photos !== 'number' ||
        !Number.isSafeInteger(v.photos) ||
        v.photos < 0
      )
        throw Error();
      cursor = { id: v.id, photos: v.photos, named: view === 'ALL' && v.named === true };
    } catch {
      throw new BadRequestException('人物分页游标无效。');
    }
  }
  const rows = await tx.$queryRaw<
    Array<{ id: string; photos: bigint; faceId: string | null; named: boolean }>
  >`WITH counts AS (
 SELECT p.id,(p.name IS NOT NULL) AS named,count(DISTINCT a.id) AS photos,(array_agg(f.id ORDER BY f.confidence DESC,f.id) FILTER(WHERE a.id IS NOT NULL))[1] AS "faceId" FROM "EaglePhotoPerson" p
 LEFT JOIN "EaglePhotoFace" f ON f."personId"=p.id AND f."ownerId"=p."ownerId" AND f."libraryMode"=p."libraryMode" AND f."isCurrent"
 LEFT JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode" AND a."mediaRevision"=f."assetRevision" AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
 WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO' AND (${view === 'ALL'} OR p.name IS NULL) AND (${includePrivate} OR NOT p."marksAssetsPrivate")
 GROUP BY p.id HAVING count(DISTINCT a.id)>0 OR (${includePrivate} AND p."marksAssetsPrivate")
 ) SELECT id,named,photos,"faceId" FROM counts
 WHERE ${!cursor} OR named<${cursor?.named ?? false}
   OR (named=${cursor?.named ?? false} AND (photos<${cursor?.photos ?? 0} OR (photos=${cursor?.photos ?? 0} AND id>${cursor?.id ?? ''})))
 ORDER BY named DESC,photos DESC,id LIMIT 25`;
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
              view,
              version: view === 'ALL' ? 2 : 1,
              named: last.named,
              id: last.id,
              photos: Number(last.photos),
            }),
          ).toString('base64url')
        : null,
  };
}
