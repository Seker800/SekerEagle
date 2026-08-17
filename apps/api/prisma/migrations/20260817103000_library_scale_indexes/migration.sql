-- The default gallery is the hottest path and only reads active assets in reverse library order.
-- Keeping this index partial avoids carrying trashed rows and removes the need for a top-N sort.
CREATE INDEX "EagleAsset_active_library_order_idx"
ON "EagleAsset"("ownerId", "libraryAddedAt" DESC, "id" DESC)
WHERE "deletedAt" IS NULL;

-- Color filtering narrows all three Lab dimensions for one owner.
CREATE INDEX "EagleAssetColorSwatch_ownerId_labL_labA_labB_idx"
ON "EagleAssetColorSwatch"("ownerId", "labL", "labA", "labB");
