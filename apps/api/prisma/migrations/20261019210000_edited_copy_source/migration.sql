-- A frozen upload declaration, deliberately retained if its source is later purged.
-- Finalization must re-authorize the source in the upload's owner and immutable library.
ALTER TABLE "EagleUploadSessionState"
  ADD COLUMN "copySourceAssetId" TEXT,
  ADD COLUMN "copySourceRowVersion" INTEGER;
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_copy_source_declaration"
  CHECK (("copySourceAssetId" IS NULL AND "copySourceRowVersion" IS NULL) OR
    ("copySourceAssetId" IS NOT NULL AND "copySourceRowVersion" IS NOT NULL AND "copySourceRowVersion" >= 1 AND "duplicatePolicy" = 'CREATE_COPY' AND "replacementAssetId" IS NULL));
