-- Per-owner, per-library watermark appearance presets. Photo-specific text stays in the edit recipe.
CREATE TABLE "EagleWatermarkPreset" (
  "ownerId" TEXT NOT NULL,
  "libraryMode" "LibraryMode" NOT NULL,
  "templateId" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleWatermarkPreset_pkey" PRIMARY KEY ("ownerId", "libraryMode", "templateId")
);

CREATE INDEX "EagleWatermarkPreset_ownerId_libraryMode_idx"
  ON "EagleWatermarkPreset"("ownerId", "libraryMode");

ALTER TABLE "EagleWatermarkPreset"
  ADD CONSTRAINT "EagleWatermarkPreset_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
