CREATE TABLE "EaglePrivacyPreference" (
  "ownerId" TEXT NOT NULL,
  "durationHours" INTEGER NOT NULL DEFAULT 3,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EaglePrivacyPreference_pkey" PRIMARY KEY ("ownerId"),
  CONSTRAINT "EaglePrivacyPreference_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "EagleAsset"
  ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EagleAsset_ownerId_isPrivate_deletedAt_libraryAddedAt_id_idx"
  ON "EagleAsset"("ownerId", "isPrivate", "deletedAt", "libraryAddedAt", "id");
