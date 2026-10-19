import { Prisma, type LibraryMode } from '@prisma/client';

// Called while holding the asset row lock, in the replacement transaction.
export async function invalidateMediaRevision(
  tx: Prisma.TransactionClient,
  scope: { ownerId: string; libraryMode: LibraryMode; assetId: string },
  revision: number,
) {
  const { ownerId, libraryMode, assetId } = scope;
  await tx.$executeRaw(Prisma.sql`
    WITH jobs AS (
      UPDATE "EagleMediaJob" SET status='COMPLETED', "leaseVersion"="leaseVersion"+1,
        "lockedAt"=NULL,"completedAt"=now(),"lastError"='SUPERSEDED_MEDIA_REVISION',"updatedAt"=now()
      WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND "assetId"=${assetId}
        AND "assetRevision"<${revision} AND kind<>'PURGE_ASSET' AND status IN ('PROCESSING','PENDING')
    ), tags AS (
      UPDATE "EagleAssetAiTag" SET status='HIDDEN'
      WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND "assetId"=${assetId} AND status='ACTIVE'
    ), colors AS (
      UPDATE "EagleAssetColorAnalysis" SET "isCurrent"=false
      WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND "assetId"=${assetId} AND "assetRevision"<${revision}
    ), embeddings AS (
      UPDATE "EagleAssetEmbedding" SET "isCurrent"=false
      WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND "assetId"=${assetId} AND "assetRevision"<${revision}
    ), suggestions AS (
      UPDATE "EagleVectorTagSuggestion" SET "isActive"=false,"invalidatedAt"=now()
      WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode" AND "assetId"=${assetId} AND "isActive"=true
    )
    INSERT INTO "EagleObjectDeletion" (id,"ownerId","libraryMode","objectKeys",prefixes,"updatedAt")
    SELECT gen_random_uuid()::text, ${ownerId}, ${libraryMode}::"LibraryMode", ARRAY[]::text[],
      array_agg("storagePrefix"||'/'), now()
    FROM "EagleImagePyramid" WHERE "ownerId"=${ownerId} AND "libraryMode"=${libraryMode}::"LibraryMode"
      AND "assetId"=${assetId} AND revision<${revision} HAVING count(*)>0
  `);
}
