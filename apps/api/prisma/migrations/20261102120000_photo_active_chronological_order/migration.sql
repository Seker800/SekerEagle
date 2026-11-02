-- Cover the canonical photo ordering directly. Private-visible and public reads
-- both need an ordered path; keep trashed rows and other library modes out.
CREATE INDEX "EagleAsset_photo_active_order_idx"
ON "EagleAsset" ("ownerId", "chronologicalAt" DESC, id DESC)
WHERE "libraryMode"='PHOTO' AND "deletedAt" IS NULL;

CREATE INDEX "EagleAsset_photo_public_active_order_idx"
ON "EagleAsset" ("ownerId", "chronologicalAt" DESC, id DESC)
WHERE "libraryMode"='PHOTO' AND "deletedAt" IS NULL AND NOT "isPrivate";
