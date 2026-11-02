import { rejectLibraryRead } from '../eagle/eagle-memory-client';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readMemoryPeopleCounts } from './photo-memory-client';
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
  const cached = await readMemoryPeopleCounts(ownerId, includePrivate);
  let resident: Prisma.Sql | undefined;
  if (cached) {
    // This first API-transaction read fixes its repeatable-read snapshot. Only use
    // resident counts if their canonical-data revision is identical to that snapshot.
    const [state] = await tx.$queryRaw<
      Array<{ revision: bigint }>
    >`SELECT revision FROM "EagleLibraryReadState" WHERE "ownerId"=${ownerId} AND "libraryMode"='PHOTO'`;
    if (state && String(state.revision) === cached.revision) {
      resident = Prisma.sql`SELECT p.id,(p.name IS NOT NULL) AS named,COALESCE(c.photos,0::bigint) AS photos
        FROM "EaglePhotoPerson" p
        LEFT JOIN jsonb_to_recordset(${JSON.stringify(cached.counts)}::jsonb) AS c(id text,photos bigint) ON c.id=p.id
        WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO'
          AND (${view === 'ALL'} OR p.name IS NULL) AND (${includePrivate} OR NOT p."marksAssetsPrivate")
          AND (COALESCE(c.photos,0)>0 OR (${includePrivate} AND p."marksAssetsPrivate"))`;
    } else rejectLibraryRead('peopleCounts');
  }
  const counts =
    resident ??
    Prisma.sql`
    SELECT p.id, (p.name IS NOT NULL) AS named, count(DISTINCT a.id) AS photos
    FROM "EaglePhotoPerson" p
    LEFT JOIN "EaglePhotoFace" f ON f."personId"=p.id AND f."ownerId"=p."ownerId"
      AND f."libraryMode"=p."libraryMode" AND f."isCurrent"
    LEFT JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId"
      AND a."libraryMode"=f."libraryMode" AND a."mediaRevision"=f."assetRevision"
      AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
    WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO'
      AND (${view === 'ALL'} OR p.name IS NULL) AND (${includePrivate} OR NOT p."marksAssetsPrivate")
    GROUP BY p.id
    HAVING count(DISTINCT a.id)>0 OR (${includePrivate} AND p."marksAssetsPrivate")
`;
  // Counts own global ordering; representative selection only touches the selected page.
  const rows = await tx.$queryRaw<
    Array<{ id: string; photos: bigint; faceId: string | null; named: boolean }>
  >`WITH counts AS (
    ${counts}
  ), page AS MATERIALIZED (
    SELECT id,named,photos FROM counts
    WHERE ${!cursor} OR named<${cursor?.named ?? false}
      OR (named=${cursor?.named ?? false} AND (photos<${cursor?.photos ?? 0}
        OR (photos=${cursor?.photos ?? 0} AND id>${cursor?.id ?? ''})))
    ORDER BY named DESC,photos DESC,id LIMIT 25
  )
  SELECT page.*, representative."faceId" FROM page
  LEFT JOIN LATERAL (
    SELECT f.id AS "faceId" FROM "EaglePhotoFace" f
    JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId"
      AND a."libraryMode"=f."libraryMode" AND a."mediaRevision"=f."assetRevision"
      AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
    WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."isCurrent" AND f."personId"=page.id
    ORDER BY f.confidence DESC,f.id LIMIT 1
  ) representative ON true
  ORDER BY page.named DESC,page.photos DESC,page.id`;
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
