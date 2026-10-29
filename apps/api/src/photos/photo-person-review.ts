import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
/** Bounded anchors; candidate scoring stays server-side and searches the visible library. */
export const PERSON_REVIEW_ANCHORS = 16;
export function reviewCursor(after: string | undefined, ownerId: string, includePrivate: boolean) {
  if (!after) return '';
  try {
    const decoded: unknown = JSON.parse(Buffer.from(after, 'base64url').toString());
    if (!decoded || typeof decoded !== 'object') throw new Error();
    const value = decoded as Record<string, unknown>;
    if (
      value.ownerId !== ownerId ||
      value.includePrivate !== includePrivate ||
      typeof value.id !== 'string' ||
      !/^[-a-zA-Z0-9]+$/.test(value.id) ||
      value.id.length > 80
    )
      throw Error();
    return value.id;
  } catch {
    throw new BadRequestException('人物确认游标无效。');
  }
}
export const encodeReviewCursor = (id: string, ownerId: string, includePrivate: boolean) =>
  Buffer.from(JSON.stringify({ id, ownerId, includePrivate })).toString('base64url');
export function personReviewCandidatesSql(ownerId: string, includePrivate: boolean, after: string) {
  return Prisma.sql`
WITH visible_faces AS MATERIALIZED (
 SELECT f.id,f.confidence,f."personId",f."assetId",f."assetRevision",f."modelVersion"
 FROM "EaglePhotoFace" f JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode"
 WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."isCurrent" AND f."assetRevision"=a."mediaRevision"
 AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
 AND EXISTS(SELECT 1 FROM "EagleAssetRendition" r WHERE r."ownerId"=a."ownerId" AND r."libraryMode"='PHOTO' AND r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='PREVIEW' AND r.status='READY' AND r.variant='default')
), eligible AS MATERIALIZED (
 SELECT p.id,p.name,p."rowVersion",p.prototype,p."modelVersion"
 FROM "EaglePhotoPerson" p WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO'
 AND (${includePrivate} OR NOT p."marksAssetsPrivate") AND array_length(p.prototype,1)=128
 AND EXISTS (SELECT 1 FROM visible_faces f WHERE f."personId"=p.id AND f."modelVersion"=p."modelVersion")
), anchors AS (SELECT * FROM eligible WHERE name IS NULL AND id>${after} ORDER BY id LIMIT ${PERSON_REVIEW_ANCHORS + 1}),
work AS MATERIALIZED (SELECT * FROM anchors ORDER BY id LIMIT ${PERSON_REVIEW_ANCHORS}),
cooccurring AS MATERIALIZED (
 SELECT DISTINCT w.id AS anchor,f2."personId" AS candidate FROM work w
 JOIN visible_faces f1 ON f1."personId"=w.id
 JOIN visible_faces f2 ON f2."assetId"=f1."assetId" AND f2."assetRevision"=f1."assetRevision"
)
SELECT a.id AS "anchorId", b.id AS "candidateId",b.score,
 ARRAY(SELECT f.id FROM visible_faces f WHERE f."personId"=a.id AND f."modelVersion"=a."modelVersion" ORDER BY f.confidence DESC,f.id LIMIT 3) AS "anchorFaceIds",
 ARRAY(SELECT f.id FROM visible_faces f WHERE f."personId"=b.id AND f."modelVersion"=a."modelVersion" ORDER BY f.confidence DESC,f.id LIMIT 3) AS "candidateFaceIds",
 (SELECT max(id) FROM work) AS "lastAnchor",(SELECT count(*)>${PERSON_REVIEW_ANCHORS} FROM anchors) AS "hasMore"
FROM work a LEFT JOIN LATERAL (
 SELECT e.id,1-(a.prototype::vector <=> e.prototype::vector) AS score FROM eligible e
 WHERE e.id<>a.id AND e."modelVersion"=a."modelVersion"
 AND NOT EXISTS(SELECT 1 FROM "EaglePhotoPersonSeparation" d WHERE d."ownerId"=${ownerId} AND d."libraryMode"='PHOTO' AND d."firstId"=LEAST(a.id,e.id) AND d."secondId"=GREATEST(a.id,e.id))
 AND NOT EXISTS(SELECT 1 FROM cooccurring c WHERE c.anchor=a.id AND c.candidate=e.id)
 AND (1-(a.prototype::vector <=> e.prototype::vector))>=0.3
 ORDER BY a.prototype::vector <=> e.prototype::vector,e.id LIMIT 2
) b ON true ORDER BY b.score DESC NULLS LAST,a.id,b.id`;
}
export async function carryPersonSeparations(
  tx: Prisma.TransactionClient,
  ownerId: string,
  sourceId: string,
  targetId: string,
) {
  const rows = await tx.eaglePhotoPersonSeparation.findMany({
    where: { ownerId, libraryMode: 'PHOTO', OR: [{ firstId: sourceId }, { secondId: sourceId }] },
  });
  const data = rows.flatMap((row) => {
    const other = row.firstId === sourceId ? row.secondId : row.firstId;
    if (other === targetId) return [];
    const pair = [other, targetId].sort();
    const firstId = pair[0]!,
      secondId = pair[1]!;
    return [{ ownerId, libraryMode: 'PHOTO' as const, firstId, secondId }];
  });
  if (data.length) await tx.eaglePhotoPersonSeparation.createMany({ data, skipDuplicates: true });
}
