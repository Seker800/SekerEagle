-- Trash pages read newest deletions first; purged rows never appear in that view.
-- Public reads filter isPrivate, so they need the privacy column before the order keys.
CREATE INDEX "EagleAsset_trash_deleted_order_idx"
ON "EagleAsset" ("ownerId", "libraryMode", "deletedAt" DESC, "id" DESC)
WHERE "deletedAt" IS NOT NULL AND "purgeAfter" IS NULL;

CREATE INDEX "EagleAsset_trash_public_deleted_order_idx"
ON "EagleAsset" ("ownerId", "libraryMode", "isPrivate", "deletedAt" DESC, "id" DESC)
WHERE "deletedAt" IS NOT NULL AND "purgeAfter" IS NULL;
