ALTER TABLE "EagleAsset"
ADD COLUMN "aspectRatio" DOUBLE PRECISION
GENERATED ALWAYS AS (
  CASE
    WHEN "width" IS NOT NULL AND "height" IS NOT NULL AND "height" > 0
      THEN "width"::DOUBLE PRECISION / "height"::DOUBLE PRECISION
    ELSE NULL
  END
) STORED;

CREATE INDEX "EagleAsset_ownerId_deletedAt_aspectRatio_idx"
ON "EagleAsset"("ownerId", "deletedAt", "aspectRatio");
