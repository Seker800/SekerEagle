ALTER TABLE "EagleAssetOperation" ADD COLUMN "lastClaimedAt" TIMESTAMP(3);
CREATE INDEX "EagleAssetOperation_libraryMode_kind_lastClaimedAt_createdAt_idx"
ON "EagleAssetOperation"("libraryMode", kind, "lastClaimedAt", "createdAt");
