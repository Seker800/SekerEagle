BEGIN;
-- AlterTable
ALTER TABLE "EagleAsset" ADD COLUMN     "chronologicalAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "EagleAsset" SET "chronologicalAt" = "libraryAddedAt";

-- CreateTable
CREATE TABLE "EaglePhotoMetadata" (
    "assetId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "assetRevision" INTEGER NOT NULL,
    "processorVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3),
    "capturedLocal" TEXT,
    "captureTimeZoneKnown" BOOLEAN NOT NULL DEFAULT false,
    "cameraMake" TEXT,
    "cameraModel" TEXT,
    "lensModel" TEXT,
    "focalLength" DOUBLE PRECISION,
    "aperture" DOUBLE PRECISION,
    "exposureSeconds" DOUBLE PRECISION,
    "iso" INTEGER,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "sharpnessScore" DOUBLE PRECISION,
    "perceptualHash" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EaglePhotoMetadata_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE INDEX "EaglePhotoMetadata_ownerId_libraryMode_capturedAt_assetId_idx" ON "EaglePhotoMetadata"("ownerId", "libraryMode", "capturedAt", "assetId");

-- CreateIndex
CREATE INDEX "EaglePhotoMetadata_ownerId_libraryMode_cameraModel_idx" ON "EaglePhotoMetadata"("ownerId", "libraryMode", "cameraModel");

-- CreateIndex
CREATE INDEX "EaglePhotoMetadata_ownerId_libraryMode_lensModel_idx" ON "EaglePhotoMetadata"("ownerId", "libraryMode", "lensModel");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoMetadata_ownerId_libraryMode_assetId_key" ON "EaglePhotoMetadata"("ownerId", "libraryMode", "assetId");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_deletedAt_chronologicalAt_id_idx" ON "EagleAsset"("ownerId", "libraryMode", "deletedAt", "chronologicalAt", "id");

-- AddForeignKey
ALTER TABLE "EaglePhotoMetadata" ADD CONSTRAINT "EaglePhotoMetadata_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "EaglePhotoMetadata" ADD CONSTRAINT "EaglePhotoMetadata_photo_only" CHECK ("libraryMode" = 'PHOTO');
ALTER TABLE "EaglePhotoMetadata" ADD CONSTRAINT "EaglePhotoMetadata_coordinates" CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoMetadata" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

COMMIT;
