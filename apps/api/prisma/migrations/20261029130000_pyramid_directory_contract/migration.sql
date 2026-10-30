BEGIN;

-- A directory's trailing separator is representation, not a new media revision.
-- Copy plans keep their byte destinations; current publishers compare canonical directories.
WITH normalized AS (
  UPDATE "EagleImagePyramid"
  SET "storagePrefix" = rtrim("storagePrefix", '/'), "updatedAt" = CURRENT_TIMESTAMP
  WHERE "storagePrefix" LIKE '%/'
  RETURNING "ownerId", "libraryMode", "assetId", "storagePrefix"
)
INSERT INTO "EagleObjectDeletion" (id, "ownerId", "libraryMode", "objectKeys", prefixes, "updatedAt")
SELECT gen_random_uuid()::text, p."ownerId", p."libraryMode", ARRAY[]::text[],
       ARRAY[p."storagePrefix" || '/'], CURRENT_TIMESTAMP
FROM normalized p JOIN "EagleAsset" a
  ON a."ownerId"=p."ownerId" AND a."libraryMode"=p."libraryMode" AND a.id=p."assetId"
WHERE a."transferredAt" IS NOT NULL AND a."deletedAt" IS NOT NULL AND a."purgeAfter" IS NOT NULL;

ALTER TABLE "EagleImagePyramid" ADD CONSTRAINT "EagleImagePyramid_directory_prefix"
CHECK (length("storagePrefix") > 0 AND right("storagePrefix", 1) <> '/');

COMMIT;
