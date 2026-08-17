ALTER TYPE "EagleMediaJobKind" ADD VALUE 'GENERATE_IMAGE_PYRAMID';

CREATE TYPE "EagleImagePyramidStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

ALTER TABLE "EagleMediaJob" ADD COLUMN "dependsOnJobId" TEXT;

CREATE TABLE "EagleImagePyramid" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "processorVersion" TEXT NOT NULL,
    "status" "EagleImagePyramidStatus" NOT NULL DEFAULT 'PENDING',
    "storagePrefix" TEXT NOT NULL,
    "tileSize" INTEGER NOT NULL DEFAULT 512,
    "overlap" INTEGER NOT NULL DEFAULT 1,
    "format" TEXT NOT NULL DEFAULT 'webp',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "maxLevel" INTEGER NOT NULL,
    "tileCount" INTEGER NOT NULL DEFAULT 0,
    "byteSize" BIGINT NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImagePyramid_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EagleImagePyramid_assetId_revision_processorVersion_key"
ON "EagleImagePyramid"("assetId", "revision", "processorVersion");
CREATE UNIQUE INDEX "EagleImagePyramid_storagePrefix_key"
ON "EagleImagePyramid"("storagePrefix");
CREATE INDEX "EagleImagePyramid_ownerId_assetId_status_idx"
ON "EagleImagePyramid"("ownerId", "assetId", "status");
CREATE INDEX "EagleMediaJob_dependsOnJobId_status_idx"
ON "EagleMediaJob"("dependsOnJobId", "status");

ALTER TABLE "EagleMediaJob"
ADD CONSTRAINT "EagleMediaJob_dependsOnJobId_fkey"
FOREIGN KEY ("dependsOnJobId") REFERENCES "EagleMediaJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EagleImagePyramid"
ADD CONSTRAINT "EagleImagePyramid_ownerId_assetId_fkey"
FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
