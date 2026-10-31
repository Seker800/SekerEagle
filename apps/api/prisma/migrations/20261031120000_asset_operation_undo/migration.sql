-- A compensation is a first-class scoped relation, never a magic asset-selection ID.
ALTER TABLE "EagleAssetOperation" ADD COLUMN "undoOfId" TEXT;
CREATE UNIQUE INDEX "EagleAssetOperation_undoOfId_key" ON "EagleAssetOperation"("undoOfId");
ALTER TABLE "EagleAssetOperation"
  ADD CONSTRAINT "EagleAssetOperation_undo_scope_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "undoOfId")
  REFERENCES "EagleAssetOperation"("ownerId", "libraryMode", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "EagleAssetOperation_undo_kind_check"
  CHECK ("undoOfId" IS NULL OR kind = 'RESTORE');
