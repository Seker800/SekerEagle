import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { previewSelect, serializePreview } from './photo-preview';

/** Bounded review window, ranked across the library rather than the first people page. */
export function readPhotoPeopleReview(
  prisma: PrismaService,
  ownerId: string,
  includePrivate: boolean,
) {
  return prisma.$transaction(
    async (tx) => {
      const pairs = await tx.$queryRaw<
        Array<{
          firstId: string;
          firstFaceId: string;
          secondFaceId: string;
          secondId: string;
          firstCount: bigint;
          secondCount: bigint;
          similarity: number;
        }>
      >(Prisma.sql`
      WITH visible_faces AS MATERIALIZED (
        SELECT f."personId", f."assetId", f.id AS "faceId", f.confidence,
          browse.pixels * f.box[3] * f.box[4] AS "facePixels"
        FROM "EaglePhotoFace" f JOIN "EagleAsset" a
          ON a.id = f."assetId" AND a."ownerId" = f."ownerId" AND a."libraryMode" = f."libraryMode"
        JOIN LATERAL (
          SELECT max(COALESCE(r.width, 1)::double precision * COALESCE(r.height, 1)) AS pixels
          FROM "EagleAssetRendition" r WHERE r."assetId" = a.id
            AND r."ownerId" = a."ownerId" AND r."libraryMode" = a."libraryMode"
            AND r."revision" = a."mediaRevision" AND r.status = 'READY'
            AND r.kind IN ('PREVIEW', 'THUMBNAIL') AND r."mimeType" LIKE 'image/%'
            AND r.variant <> 'edit'
        ) browse ON browse.pixels > 0
        WHERE f."ownerId" = ${ownerId} AND f."libraryMode" = 'PHOTO'
          AND f."isCurrent" = true AND f."assetRevision" = a."mediaRevision"
          AND a."deletedAt" IS NULL
          ${includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate" = false`}

      ), candidates AS MATERIALIZED (
        SELECT p.id, p.prototype, p."modelVersion", count(DISTINCT f."assetId") AS count
        FROM "EaglePhotoPerson" p JOIN visible_faces f ON f."personId" = p.id
        WHERE p."ownerId" = ${ownerId} AND p."libraryMode" = 'PHOTO'
          ${includePrivate ? Prisma.empty : Prisma.sql`AND p."marksAssetsPrivate" = false`}
          AND cardinality(p.prototype) = 128
          AND NOT EXISTS (SELECT 1 FROM unnest(p.prototype) v
            WHERE v IS NULL OR v NOT BETWEEN -1.001 AND 1.001)
          AND EXISTS (SELECT 1 FROM unnest(p.prototype) v WHERE v <> 0)
        GROUP BY p.id ORDER BY count DESC, p.id LIMIT 400
      ), cooccurrences AS MATERIALIZED (
        SELECT DISTINCT x."personId" AS "firstId", y."personId" AS "secondId"
        FROM visible_faces x JOIN visible_faces y ON x."assetId" = y."assetId"
        WHERE x."personId" < y."personId"
      ), representatives AS (
        SELECT DISTINCT ON (f."personId") f."personId", f."faceId"
        FROM visible_faces f JOIN candidates c ON c.id = f."personId"
        ORDER BY f."personId", f."facePixels" DESC, f.confidence DESC, f."faceId"
      )
      SELECT ra."faceId" AS "firstFaceId", rb."faceId" AS "secondFaceId", a.id AS "firstId", b.id AS "secondId", a.count AS "firstCount", b.count AS "secondCount",
        (1 - (a.prototype::vector <=> b.prototype::vector)) AS similarity
      FROM candidates a JOIN candidates b ON a.id < b.id AND a."modelVersion" = b."modelVersion"
      JOIN representatives ra ON ra."personId" = a.id
      JOIN representatives rb ON rb."personId" = b.id
      WHERE (1 - (a.prototype::vector <=> b.prototype::vector)) >= 0.25
        AND NOT EXISTS (SELECT 1 FROM cooccurrences c
          WHERE c."firstId" = a.id AND c."secondId" = b.id)
      ORDER BY (a.count + b.count) DESC, LEAST(a.count, b.count) DESC, similarity DESC, a.id, b.id
      LIMIT 100
    `);
      const ids = [...new Set(pairs.flatMap((pair) => [pair.firstId, pair.secondId]))];
      if (!ids.length) return { pairs: [] };
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
              id: { in: pairs.flatMap((pair) => [pair.firstFaceId, pair.secondFaceId]) },
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
            orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
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
          return first && second
            ? [
                {
                  first: { ...first, photoCount: Number(pair.firstCount) },
                  second: { ...second, photoCount: Number(pair.secondCount) },
                  similarity: pair.similarity,
                },
              ]
            : [];
        }),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
