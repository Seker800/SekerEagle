ALTER TABLE "EagleManualTag"
  ADD COLUMN "marksAssetsPrivate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "EagleManualTag_ownerId_marksAssetsPrivate_id_idx"
  ON "EagleManualTag"("ownerId", "marksAssetsPrivate", "id");
