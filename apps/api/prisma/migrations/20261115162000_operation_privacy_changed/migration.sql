-- Terminal facts tell clients whether a command changed privacy, so caches clear only when needed.
ALTER TABLE "EagleAssetOperation" ADD COLUMN "privacyChanged" BOOLEAN NOT NULL DEFAULT false;
