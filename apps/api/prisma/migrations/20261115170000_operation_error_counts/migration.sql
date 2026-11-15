-- Error-code weights are a derived projection of FAILED operation items.
ALTER TABLE "EagleAssetOperation" ADD COLUMN "errorCounts" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "EagleAssetOperation" o
SET "errorCounts" = COALESCE((
  SELECT jsonb_object_agg("errorCode", weight)
  FROM (
    SELECT "errorCode", sum("weight")::int AS weight
    FROM "EagleAssetOperationItem"
    WHERE "operationId" = o."id"
      AND "ownerId" = o."ownerId"
      AND "libraryMode" = o."libraryMode"
      AND "status" = 'FAILED'
      AND "errorCode" IS NOT NULL
    GROUP BY "errorCode"
  ) x
), '{}'::jsonb);
