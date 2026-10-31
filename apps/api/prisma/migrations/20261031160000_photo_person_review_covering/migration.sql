BEGIN;
-- Review reads need current identity and visibility facts, never the large media
-- metadata or face embedding payload. Keep the working set in covering indexes.
CREATE INDEX "EaglePhotoFace_review_covering_idx" ON "EaglePhotoFace"
  ("ownerId","libraryMode","personId","assetId","assetRevision")
  INCLUDE (id,confidence,"modelVersion") WHERE "isCurrent";
CREATE INDEX "EagleAsset_review_visibility_covering_idx" ON "EagleAsset"
  ("ownerId","libraryMode",id,"mediaRevision") INCLUDE ("isPrivate")
  WHERE "deletedAt" IS NULL;
CREATE INDEX "EagleAssetRendition_review_preview_covering_idx" ON "EagleAssetRendition"
  ("ownerId","libraryMode","assetId",revision)
  WHERE kind='PREVIEW' AND status='READY' AND variant='default';
COMMIT;
