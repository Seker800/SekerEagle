BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "EagleUploadSessionState" ADD COLUMN "copyRecipeJson" JSONB;
CREATE TABLE "EagleAssetEditRecipe" (
 "assetId" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
 "assetRevision" INTEGER NOT NULL, "baseAssetId" TEXT, "baseMediaRevision" INTEGER NOT NULL,
 "recipe" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EagleAssetEditRecipe_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId","libraryMode","assetId") REFERENCES "EagleAsset"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EagleAssetEditRecipe_ownerId_libraryMode_baseAssetId_idx" ON "EagleAssetEditRecipe"("ownerId","libraryMode","baseAssetId");
CREATE UNIQUE INDEX "EagleAssetEditRecipe_ownerId_libraryMode_assetId_key" ON "EagleAssetEditRecipe"("ownerId","libraryMode","assetId");
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetEditRecipe" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

COMMIT;
