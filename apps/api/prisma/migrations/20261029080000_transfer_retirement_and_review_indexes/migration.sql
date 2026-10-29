BEGIN;

-- A sent source retains only its historical identity; it is not recoverable trash.
ALTER TABLE "EagleAsset" ADD COLUMN "transferredAt" TIMESTAMP(3);

-- Match the review page's deterministic score/id order, both across tags and within one tag.
CREATE INDEX "EagleVectorTagSuggestion_review_score_idx"
ON "EagleVectorTagSuggestion" ("ownerId", "libraryMode", status, score DESC, id DESC, "isActive", "invalidatedAt");
CREATE INDEX "EagleVectorTagSuggestion_review_tag_score_idx"
ON "EagleVectorTagSuggestion" ("ownerId", "libraryMode", "suggestedTagId", status, score DESC, id DESC, "isActive", "invalidatedAt");

-- Retire only untouched legacy send pairs proven by a completed durable plan.
-- Restored/edited sources, changed/missing/trashed targets and failed plans remain untouched.
WITH eligible AS (
  SELECT source.id
  FROM "EagleLibraryTransfer" transfer
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(transfer.plan) = 'array' THEN transfer.plan ELSE '[]'::jsonb END
  ) item
  JOIN "EagleAsset" source
    ON source.id = item->>'sourceId' AND source."ownerId" = transfer."ownerId"
   AND source."libraryMode" = transfer."sourceMode"
  JOIN "EagleAsset" target
    ON target.id = item->>'targetId' AND target."ownerId" = transfer."ownerId"
   AND target."libraryMode" = transfer."targetMode"
  WHERE transfer.status = 'COMPLETED' AND transfer."sourceMode" <> transfer."targetMode"
    AND source."deletedAt" IS NOT NULL AND source."purgeAfter" IS NULL AND source."transferredAt" IS NULL
    AND source."mediaRevision"::text = item->>'revision'
    AND (source."rowVersion" - 1)::text = item->>'rowVersion'
    AND source."originalObjectKey" = item->>'sourceKey'
    AND target."originalObjectKey" = item->>'targetKey'
    AND source."originalObjectKey" <> target."originalObjectKey"
    AND target."deletedAt" IS NULL AND target."purgeAfter" IS NULL
    AND target."mediaRevision" = 1 AND target."rowVersion" = 1
    AND target."byteSize" = source."byteSize" AND target.sha256 IS NOT DISTINCT FROM source.sha256
  ORDER BY source.id, target.id
  FOR UPDATE OF source, target
), retired AS (
  UPDATE "EagleAsset" source
  SET "purgeAfter" = CURRENT_TIMESTAMP, "transferredAt" = source."deletedAt",
      "rowVersion" = source."rowVersion" + 1, "updatedAt" = CURRENT_TIMESTAMP
  FROM eligible WHERE source.id = eligible.id
  RETURNING source.id, source."ownerId", source."libraryMode", source."originalObjectKey"
)
INSERT INTO "EagleObjectDeletion" (id,"ownerId","libraryMode","objectKeys",prefixes,"updatedAt")
SELECT gen_random_uuid()::text,source."ownerId",source."libraryMode",
  ARRAY(SELECT source."originalObjectKey" UNION SELECT r."storageKey" FROM "EagleAssetRendition" r
    WHERE r."ownerId"=source."ownerId" AND r."libraryMode"=source."libraryMode" AND r."assetId"=source.id),
  ARRAY(SELECT p."storagePrefix"||'/' FROM "EagleImagePyramid" p
    WHERE p."ownerId"=source."ownerId" AND p."libraryMode"=source."libraryMode" AND p."assetId"=source.id),
  CURRENT_TIMESTAMP
FROM retired source;

COMMIT;
