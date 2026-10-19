ALTER TABLE "EagleAsset" ADD COLUMN "livePhotoIdentifier" TEXT, ADD COLUMN "livePhotoRole" TEXT;
ALTER TABLE "EagleAsset" ADD CONSTRAINT "EagleAsset_live_photo_metadata_check" CHECK (
  ("livePhotoIdentifier" IS NULL AND "livePhotoRole" IS NULL) OR
  ("livePhotoIdentifier" IS NOT NULL AND "livePhotoRole" IS NOT NULL AND "livePhotoRole" IN ('STILL','MOTION') AND
   "livePhotoIdentifier" ~ '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$')
);
CREATE INDEX "EagleAsset_live_photo_pair_idx" ON "EagleAsset" ("ownerId", "libraryMode", "livePhotoIdentifier", "livePhotoRole");
