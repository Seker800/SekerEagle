import { CAMERA_MEDIA_FORMATS } from '@sekereagle/library-core';
import { Prisma, type LibraryMode } from '@prisma/client';
import { COLOR_THUMBNAIL_PROCESSOR_VERSION, PYRAMID_PROCESSOR_VERSION } from './media-job-plan';

export interface MediaProcessingFacts {
  assetId: string;
  assetRevision: number;
  renditionsReady: boolean;
  detailsReady?: boolean;
  needsDetails?: boolean;
  paletteReady: boolean;
  pyramidReady: boolean;
  embeddingReady: boolean;
}

// Durable outputs, rather than retained job history, decide whether work is missing.
export function readMediaProcessingFacts(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  ownerId: string,
  libraryMode: LibraryMode,
  assetIds: string[],
) {
  return client.$queryRaw<MediaProcessingFacts[]>(Prisma.sql`
    SELECT a.id AS "assetId", a."mediaRevision" AS "assetRevision",
      (EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='PREVIEW' AND r.variant='default' AND r.status='READY')
       AND EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='THUMBNAIL' AND r.variant='512' AND r.status='READY')
      ) AS "renditionsReady",
      (a."libraryMode"='PHOTO' OR a."mimeType" IN (${Prisma.join(CAMERA_MEDIA_FORMATS.filter((format) => format.kind === 'raw').map((format) => format.mimeType))})) AS "needsDetails",
      ((EXISTS (SELECT 1 FROM "EagleMediaJob" j WHERE j."assetId"=a.id AND j."ownerId"=a."ownerId" AND j."libraryMode"=a."libraryMode" AND j."assetRevision"=a."mediaRevision" AND j."processorVersion"='photo-source-details-v1' AND j.status='COMPLETED')
        OR EXISTS (SELECT 1 FROM "EagleAssetTransferFacts" f WHERE f."ownerId"=a."ownerId" AND f."libraryMode"=a."libraryMode" AND f."assetId"=a.id AND f."assetRevision"=a."mediaRevision" AND f."schemaVersion"=1 AND f."detailsReady"))
       AND (a."mimeType" NOT IN (${Prisma.join(CAMERA_MEDIA_FORMATS.filter((format) => format.kind === 'raw').map((format) => format.mimeType))})
         OR EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='PREVIEW' AND r.variant='edit' AND r.status='READY'))
       AND (a."libraryMode"<>'PHOTO' OR EXISTS (SELECT 1 FROM "EaglePhotoMetadata" m WHERE m."assetId"=a.id AND m."assetRevision"=a."mediaRevision" AND m."perceptualHash" IS NOT NULL AND m."sharpnessScore" IS NOT NULL))) AS "detailsReady",
      EXISTS (SELECT 1 FROM "EagleAssetColorAnalysis" c WHERE c."assetId"=a.id AND c."assetRevision"=a."mediaRevision" AND c."processorVersion"=${COLOR_THUMBNAIL_PROCESSOR_VERSION} AND c."isCurrent" AND c.status='COMPLETED') AS "paletteReady",
      EXISTS (SELECT 1 FROM "EagleImagePyramid" p WHERE p."assetId"=a.id AND p.revision=a."mediaRevision" AND p."processorVersion"=${PYRAMID_PROCESSOR_VERSION} AND p.status='READY') AS "pyramidReady",
      EXISTS (SELECT 1 FROM "EagleAssetEmbedding" e JOIN "EagleEmbeddingSpace" s ON s.id=e."spaceId" AND s."isCurrent" WHERE e."assetId"=a.id AND e."assetRevision"=a."mediaRevision" AND e."isCurrent" AND e.status='READY') AS "embeddingReady"
    FROM "EagleAsset" a WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
      AND a.id IN (${Prisma.join(assetIds)}) AND a."deletedAt" IS NULL
  `);
}
