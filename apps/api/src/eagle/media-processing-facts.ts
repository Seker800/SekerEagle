import { Prisma, type LibraryMode } from '@prisma/client';
import { COLOR_THUMBNAIL_PROCESSOR_VERSION, PYRAMID_PROCESSOR_VERSION } from './media-job-plan';

export interface MediaProcessingFacts {
  assetId: string;
  assetRevision: number;
  renditionsReady: boolean;
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
      (EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='PREVIEW' AND r.status='READY')
       AND EXISTS (SELECT 1 FROM "EagleAssetRendition" r WHERE r."assetId"=a.id AND r.revision=a."mediaRevision" AND r.kind='THUMBNAIL' AND r.variant='512' AND r.status='READY')) AS "renditionsReady",
      EXISTS (SELECT 1 FROM "EagleAssetColorAnalysis" c WHERE c."assetId"=a.id AND c."assetRevision"=a."mediaRevision" AND c."processorVersion"=${COLOR_THUMBNAIL_PROCESSOR_VERSION} AND c."isCurrent" AND c.status='COMPLETED') AS "paletteReady",
      EXISTS (SELECT 1 FROM "EagleImagePyramid" p WHERE p."assetId"=a.id AND p.revision=a."mediaRevision" AND p."processorVersion"=${PYRAMID_PROCESSOR_VERSION} AND p.status='READY') AS "pyramidReady",
      EXISTS (SELECT 1 FROM "EagleAssetEmbedding" e JOIN "EagleEmbeddingSpace" s ON s.id=e."spaceId" AND s."isCurrent" WHERE e."assetId"=a.id AND e."assetRevision"=a."mediaRevision" AND e."isCurrent" AND e.status='READY') AS "embeddingReady"
    FROM "EagleAsset" a WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
      AND a.id IN (${Prisma.join(assetIds)}) AND a."deletedAt" IS NULL
  `);
}
