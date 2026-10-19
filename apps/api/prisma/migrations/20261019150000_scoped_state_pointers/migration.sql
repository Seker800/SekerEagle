-- SET NULL affects only the optional pointer, preserving owner and immutable mode.
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_activeUploadSession_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "activeUploadSessionId") REFERENCES "UploadSession" ("uploaderId", "libraryMode", id) ON DELETE SET NULL ("activeUploadSessionId");
ALTER TABLE "EagleManualTagSemanticConfig" ADD CONSTRAINT "EagleManualTagSemanticConfig_currentSnapshot_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "currentSnapshotId") REFERENCES "EagleTagPrototypeSnapshot" ("ownerId", "libraryMode", id) ON DELETE SET NULL ("currentSnapshotId");
ALTER TABLE "EagleAssetManualTag" ADD CONSTRAINT "EagleAssetManualTag_acceptedSuggestion_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "acceptedSuggestionId") REFERENCES "EagleVectorTagSuggestion" ("ownerId", "libraryMode", id) ON DELETE SET NULL ("acceptedSuggestionId");
CREATE INDEX "EagleVectorTagSuggestion_ownerId_libraryMode_snapshotId_idx" ON "EagleVectorTagSuggestion" ("ownerId", "libraryMode", "snapshotId");
CREATE INDEX "EagleVectorTagSuggestion_ownerId_libraryMode_embeddingId_idx" ON "EagleVectorTagSuggestion" ("ownerId", "libraryMode", "embeddingId");
