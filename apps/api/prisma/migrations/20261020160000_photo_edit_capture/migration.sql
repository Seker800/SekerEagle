-- A published edit retains the original exposure facts even when its PNG has no EXIF.
-- Derived sharpness/hash are still recomputed from each edited image's pixels.
ALTER TABLE "EaglePhotoMetadata" ADD COLUMN "captureMetadataInherited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EaglePhotoGroup" DROP CONSTRAINT photo_group_kind;
ALTER TABLE "EaglePhotoGroup" ADD CONSTRAINT photo_group_kind CHECK (kind IN ('BURST','SIMILAR','MANUAL','EDITED'));
