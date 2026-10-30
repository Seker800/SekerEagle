import { Prisma } from '@prisma/client';
import { PHOTO_FACE_MODEL_VERSION } from '@sekereagle/library-core';
import { normalizeEmbedding } from '@sekereagle/vector-core';
import type { PrismaService } from '../prisma/prisma.service';
import { previewSelect, serializePreview } from './photo-preview';
import {
  PERSON_REVIEW_RETRIEVAL_SIMILARITY,
  qualifyPersonReviewPairs,
  readPersonReviewEvidence,
} from './photo-person-review-evidence';

type Candidate = {
  id: string;
  name?: string | null;
  prototype: number[];
  modelVersion: string;
  count: bigint;
};
type Pair = {
  firstId: string;
  secondId: string;
  firstCount: bigint;
  secondCount: bigint;
  similarity: number;
};

/** Only the 400 selected prototypes enter pairwise computation; biometrics never leave the API. */
export function rankPhotoPeopleReviewCandidates(
  candidates: Candidate[],
  blocked: Array<{ firstId: string; secondId: string }>,
): Pair[] {
  const excluded = new Set(
    blocked.map((pair) => JSON.stringify([pair.firstId, pair.secondId].sort())),
  );
  const normalized = candidates.flatMap((candidate) => {
    if (
      candidate.prototype.length !== 128 ||
      candidate.prototype.some((value) => !Number.isFinite(value) || Math.abs(value) > 1.001)
    )
      return [];
    try {
      return [{ ...candidate, prototype: normalizeEmbedding(candidate.prototype) }];
    } catch {
      return [];
    }
  });
  const pairs: Pair[] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const first = normalized[i]!,
        second = normalized[j]!;
      if (
        first.modelVersion !== second.modelVersion ||
        (Boolean(first.name?.trim()) && Boolean(second.name?.trim())) ||
        excluded.has(JSON.stringify([first.id, second.id].sort()))
      )
        continue;
      const similarity = first.prototype.reduce(
        (sum, value, index) => sum + value * second.prototype[index]!,
        0,
      );
      if (similarity >= PERSON_REVIEW_RETRIEVAL_SIMILARITY)
        pairs.push({
          firstId: first.id,
          secondId: second.id,
          firstCount: first.count,
          secondCount: second.count,
          similarity,
        });
    }
  }
  const degree = new Map<string, number>();
  return pairs
    .sort((a, b) => {
      const totalA = a.firstCount + a.secondCount,
        totalB = b.firstCount + b.secondCount;
      const minimumA = a.firstCount < a.secondCount ? a.firstCount : a.secondCount;
      const minimumB = b.firstCount < b.secondCount ? b.firstCount : b.secondCount;
      return (
        b.similarity - a.similarity ||
        (totalA !== totalB
          ? totalA > totalB
            ? -1
            : 1
          : minimumA !== minimumB
            ? minimumA > minimumB
              ? -1
              : 1
            : a.firstId.localeCompare(b.firstId) || a.secondId.localeCompare(b.secondId))
      );
    })
    .filter((pair) => {
      // A popular identity must not consume the entire evidence window.
      if ((degree.get(pair.firstId) ?? 0) >= 4 || (degree.get(pair.secondId) ?? 0) >= 4)
        return false;
      degree.set(pair.firstId, (degree.get(pair.firstId) ?? 0) + 1);
      degree.set(pair.secondId, (degree.get(pair.secondId) ?? 0) + 1);
      return true;
    })
    .slice(0, 800);
}

export function readPhotoPeopleReview(
  prisma: PrismaService,
  ownerId: string,
  includePrivate: boolean,
) {
  return prisma.$transaction(
    async (tx) => {
      // Indexed base-table joins remain usable even before a newly imported owner's statistics refresh.
      const candidates = await tx.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT p.id, p.name, p.prototype, p."modelVersion", count(DISTINCT f."assetId") AS count
      FROM "EaglePhotoPerson" p JOIN "EaglePhotoFace" f
        ON f."personId" = p.id AND f."ownerId" = p."ownerId" AND f."libraryMode" = p."libraryMode" AND f."isCurrent" = true
      JOIN "EagleAsset" a ON a.id = f."assetId" AND a."ownerId" = f."ownerId" AND a."libraryMode" = f."libraryMode"
      WHERE p."ownerId" = ${ownerId} AND p."libraryMode" = 'PHOTO'
        AND p."modelVersion" = ${PHOTO_FACE_MODEL_VERSION} AND f."modelVersion" = p."modelVersion"
        AND f."assetRevision" = a."mediaRevision" AND a."deletedAt" IS NULL
        ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false AND p."marksAssetsPrivate" = false`}
        AND cardinality(p.prototype) = 128
        AND NOT EXISTS (SELECT 1 FROM unnest(p.prototype) v WHERE v IS NULL OR v NOT BETWEEN -1.001 AND 1.001)
        AND EXISTS (SELECT 1 FROM unnest(p.prototype) v WHERE abs(v) > 0.000001)
        AND EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId" = a.id
          AND r."ownerId" = a."ownerId" AND r."libraryMode" = a."libraryMode"
          AND r."revision" = a."mediaRevision" AND r.status = 'READY'
          AND r.kind IN ('PREVIEW', 'THUMBNAIL') AND r."mimeType" LIKE 'image/%' AND r.variant <> 'edit')
      GROUP BY p.id ORDER BY count DESC, p.id LIMIT 400
    `);
      if (candidates.length < 2) return { pairs: [] };
      const candidateIds = candidates.map((candidate) => candidate.id);
      const blocked = await tx.$queryRaw<Array<{ firstId: string; secondId: string }>>(Prisma.sql`
      SELECT DISTINCT x."personId" AS "firstId", y."personId" AS "secondId"
      FROM "EaglePhotoFace" x JOIN "EaglePhotoFace" y
        ON y."ownerId" = x."ownerId" AND y."libraryMode" = x."libraryMode" AND y."assetId" = x."assetId"
        AND x."personId" < y."personId" AND y."isCurrent" = true
      JOIN "EagleAsset" a ON a.id = x."assetId" AND a."ownerId" = x."ownerId" AND a."libraryMode" = x."libraryMode"
      WHERE x."ownerId" = ${ownerId} AND x."libraryMode" = 'PHOTO' AND x."isCurrent" = true
        AND x."personId" IN (${Prisma.join(candidateIds)}) AND y."personId" IN (${Prisma.join(candidateIds)})
        AND x."assetRevision" = a."mediaRevision" AND y."assetRevision" = a."mediaRevision" AND a."deletedAt" IS NULL
        ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false`}
    `);
      const separations = await tx.eaglePhotoPersonSeparation.findMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          firstId: { in: candidateIds },
          secondId: { in: candidateIds },
        },
        select: { firstId: true, secondId: true },
      });
      const retrieved = rankPhotoPeopleReviewCandidates(candidates, [...blocked, ...separations]);
      const evidence = await readPersonReviewEvidence(
        tx,
        ownerId,
        includePrivate,
        retrieved.flatMap((p) => [p.firstId, p.secondId]),
      );
      const pairs = qualifyPersonReviewPairs(retrieved, evidence);
      const ids = [...new Set(pairs.flatMap((pair) => [pair.firstId, pair.secondId]))];
      if (!ids.length) return { pairs: [] };
      const faceIds = pairs.flatMap((p) => [p.firstFaceId, p.secondFaceId]);
      const people = await tx.eaglePhotoPerson.findMany({
        where: {
          ownerId,
          libraryMode: 'PHOTO',
          id: { in: ids },
          ...(!includePrivate ? { marksAssetsPrivate: false } : {}),
        },
        select: {
          id: true,
          name: true,
          rowVersion: true,
          marksAssetsPrivate: true,
          faces: {
            where: {
              id: { in: faceIds },
              isCurrent: true,
              asset: {
                ownerId,
                libraryMode: 'PHOTO',
                deletedAt: null,
                ...(!includePrivate ? { isPrivate: false } : {}),
              },
            },
            select: {
              id: true,
              box: true,
              confidence: true,
              assetId: true,
              assetRevision: true,
              asset: { select: previewSelect },
            },
            take: 1,
          },
        },
      });
      const byId = new Map(
        people.map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            rowVersion: p.rowVersion,
            marksAssetsPrivate: p.marksAssetsPrivate,
            faces: p.faces
              .filter((f) => f.assetRevision === f.asset.mediaRevision)
              .map((f) => ({
                id: f.id,
                box: f.box,
                confidence: f.confidence,
                assetId: f.assetId,
                asset: serializePreview(f.asset),
              })),
          },
        ]),
      );
      return {
        pairs: pairs.flatMap((pair) => {
          const first = byId.get(pair.firstId),
            second = byId.get(pair.secondId);
          const firstFace = first?.faces.find((f) => f.id === pair.firstFaceId),
            secondFace = second?.faces.find((f) => f.id === pair.secondFaceId);
          return first && second && firstFace && secondFace
            ? [
                {
                  first: { ...first, faces: [firstFace], photoCount: Number(pair.firstCount) },
                  second: { ...second, faces: [secondFace], photoCount: Number(pair.secondCount) },
                  similarity: pair.similarity,
                },
              ]
            : [];
        }),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 15000 },
  );
}
