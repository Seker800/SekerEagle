ALTER TABLE "EagleAssetRendition"
ADD COLUMN "variant" TEXT NOT NULL DEFAULT 'default';

DROP INDEX "EagleAssetRendition_assetId_kind_revision_key";

CREATE UNIQUE INDEX "EagleAssetRendition_assetId_kind_revision_variant_key"
ON "EagleAssetRendition"("assetId", "kind", "revision", "variant");
