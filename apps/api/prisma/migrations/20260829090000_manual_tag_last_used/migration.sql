ALTER TABLE "EagleManualTag" ADD COLUMN "lastUsedAt" TIMESTAMP(3);

UPDATE "EagleManualTag" AS tag
SET "lastUsedAt" = recent."lastUsedAt"
FROM (
  SELECT "ownerId", "tagId", MAX("createdAt") AS "lastUsedAt"
  FROM "EagleAssetManualTag"
  WHERE "assignedByUser" = true
  GROUP BY "ownerId", "tagId"
) AS recent
WHERE tag."ownerId" = recent."ownerId" AND tag.id = recent."tagId";

CREATE INDEX "EagleManualTag_ownerId_lastUsedAt_id_idx"
ON "EagleManualTag"("ownerId", "lastUsedAt" DESC, id);
