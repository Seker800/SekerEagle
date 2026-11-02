-- Immutable shared command parameters are stored once, including portable LUT data.
ALTER TABLE "EagleAssetOperation" ADD COLUMN "commandPayload" JSONB;
ALTER TABLE "EagleEditRender" ADD COLUMN "commandOperationId" TEXT;
ALTER TABLE "EagleEditRender" ADD CONSTRAINT "EagleEditRender_ownerId_libraryMode_commandOperationId_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "commandOperationId")
  REFERENCES "EagleAssetOperation" ("ownerId", "libraryMode", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE INDEX "EagleEditRender_ownerId_libraryMode_resultAssetId_idx"
  ON "EagleEditRender" ("ownerId", "libraryMode", "resultAssetId");
CREATE INDEX "EagleEditRender_ownerId_libraryMode_commandOperationId_idx"
  ON "EagleEditRender" ("ownerId", "libraryMode", "commandOperationId");
