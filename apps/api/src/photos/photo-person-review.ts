import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
export const PERSON_REVIEW_ANCHORS = 8;
export const PERSON_REVIEW_CANDIDATES_PER_ROUND = 2;
export type ReviewCursor = {
  id: string;
  round: number;
  photos: number;
  confidence: number;
  found: boolean;
};
export function reviewCursor(
  after: string | undefined,
  ownerId: string,
  includePrivate: boolean,
): ReviewCursor {
  if (!after) return { id: '', round: 0, photos: 0, confidence: 0, found: false };
  try {
    const value: unknown = JSON.parse(Buffer.from(after, 'base64url').toString());
    if (!value || typeof value !== 'object') throw new Error();
    const v = value as Record<string, unknown>;
    if (
      v.ownerId !== ownerId ||
      v.includePrivate !== includePrivate ||
      v.version !== 2 ||
      typeof v.id !== 'string' ||
      !/^[-a-zA-Z0-9]{0,80}$/.test(v.id) ||
      typeof v.round !== 'number' ||
      !Number.isSafeInteger(v.round) ||
      v.round > Number.MAX_SAFE_INTEGER / PERSON_REVIEW_CANDIDATES_PER_ROUND ||
      v.round < 0 ||
      typeof v.photos !== 'number' ||
      !Number.isSafeInteger(v.photos) ||
      v.photos < 0 ||
      typeof v.confidence !== 'number' ||
      !Number.isFinite(v.confidence) ||
      typeof v.found !== 'boolean'
    )
      throw new Error();
    return { id: v.id, round: v.round, photos: v.photos, confidence: v.confidence, found: v.found };
  } catch {
    throw new BadRequestException('人物确认游标无效。');
  }
}
export const encodeReviewCursor = (
  cursor: ReviewCursor,
  ownerId: string,
  includePrivate: boolean,
) =>
  Buffer.from(JSON.stringify({ ...cursor, ownerId, includePrivate, version: 2 })).toString(
    'base64url',
  );
/** Each wave examines the next neighbours for every anchor; no confidence or similarity cutoff. */
export function personReviewCandidatesSql(
  ownerId: string,
  includePrivate: boolean,
  after: ReviewCursor,
) {
  return Prisma.sql`
WITH visible_faces AS MATERIALIZED (
 SELECT f.id,f.confidence,f."personId",f."assetId",f."assetRevision",f."modelVersion"
 FROM "EaglePhotoFace" f JOIN "EagleAsset" a ON a.id=f."assetId" AND a."ownerId"=f."ownerId" AND a."libraryMode"=f."libraryMode"
 WHERE f."ownerId"=${ownerId} AND f."libraryMode"='PHOTO' AND f."isCurrent" AND f."assetRevision"=a."mediaRevision"
 AND a."deletedAt" IS NULL AND (${includePrivate} OR NOT a."isPrivate")
 AND EXISTS(SELECT 1 FROM "EagleAssetRendition" r WHERE r."ownerId"=a."ownerId" AND r."libraryMode"='PHOTO' AND r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='PREVIEW' AND r.status='READY' AND r.variant='default')
), eligible AS MATERIALIZED (
 SELECT p.id,p.name,p.prototype::vector AS prototype,p."modelVersion",count(DISTINCT f."assetId") AS photos,
 COALESCE(max(f.confidence) FILTER (WHERE f.confidence BETWEEN 0 AND 1),0) AS confidence
 FROM "EaglePhotoPerson" p JOIN visible_faces f ON f."personId"=p.id AND f."modelVersion"=p."modelVersion"
 WHERE p."ownerId"=${ownerId} AND p."libraryMode"='PHOTO' AND p."modelVersion"=${PHOTO_FACE_MODEL_VERSION}
 AND (${includePrivate} OR NOT p."marksAssetsPrivate") AND cardinality(p.prototype)=128
 AND NOT EXISTS (SELECT 1 FROM unnest(p.prototype) v WHERE v IS NULL OR v NOT BETWEEN -1.001 AND 1.001)
 AND EXISTS (SELECT 1 FROM unnest(p.prototype) v WHERE abs(v)>0.000001)
 GROUP BY p.id
), anchors AS MATERIALIZED (
 SELECT * FROM eligible
 WHERE ${!after.id} OR photos<${after.photos} OR (photos=${after.photos} AND confidence<${after.confidence})
 OR (photos=${after.photos} AND confidence=${after.confidence} AND id>${after.id})
 ORDER BY photos DESC,confidence DESC,id LIMIT ${PERSON_REVIEW_ANCHORS + 1}
), work AS MATERIALIZED (SELECT * FROM anchors ORDER BY photos DESC,confidence DESC,id LIMIT ${PERSON_REVIEW_ANCHORS}),
cooccurring AS MATERIALIZED (
 SELECT DISTINCT w.id AS anchor,f2."personId" AS candidate FROM work w
 JOIN visible_faces f1 ON f1."personId"=w.id JOIN visible_faces f2 ON f2."assetId"=f1."assetId" AND f2."assetRevision"=f1."assetRevision"
)
SELECT a.id AS "anchorId",a.photos AS "anchorPhotos",a.confidence AS "anchorConfidence",b.id AS "candidateId",b.photos AS "candidatePhotos",b.score,
 (SELECT count(*)>${PERSON_REVIEW_ANCHORS} FROM anchors) AS "hasMore"
FROM work a LEFT JOIN LATERAL (
 SELECT e.id,e.photos,1-(a.prototype <=> e.prototype) AS score FROM eligible e
 WHERE (a.photos>e.photos OR (a.photos=e.photos AND a.confidence>e.confidence)
   OR (a.photos=e.photos AND a.confidence=e.confidence AND a.id<e.id)) AND e."modelVersion"=a."modelVersion"
 AND NOT EXISTS(SELECT 1 FROM cooccurring c WHERE c.anchor=a.id AND c.candidate=e.id)
 AND NOT EXISTS(SELECT 1 FROM "EaglePhotoPersonSeparation" d WHERE d."ownerId"=${ownerId} AND d."libraryMode"='PHOTO' AND d."firstId"=LEAST(a.id,e.id) AND d."secondId"=GREATEST(a.id,e.id))
 ORDER BY a.prototype <=> e.prototype,e.photos DESC,e.confidence DESC,e.id
 LIMIT ${PERSON_REVIEW_CANDIDATES_PER_ROUND} OFFSET ${after.round * PERSON_REVIEW_CANDIDATES_PER_ROUND}
) b ON true ORDER BY a.photos DESC,a.confidence DESC,a.id,b.score DESC NULLS LAST,b.id`;
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
