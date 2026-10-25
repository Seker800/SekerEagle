-- Current immutable object lookup needs only these fields. Keep the existing unique key.
CREATE INDEX "UploadSession_completed_freshness_cover_idx"
ON "UploadSession" ("objectKey") INCLUDE ("uploaderId", "libraryMode", "completedAt")
WHERE status = 'COMPLETED';

-- Scheduler and task overview validate ownership/current revision without reading wide metadata rows.
CREATE INDEX "EagleAsset_media_scheduler_cover_idx"
ON "EagleAsset" (id) INCLUDE (
  "ownerId", "libraryMode", "mediaRevision", "deletedAt", "isPrivate",
  "originalObjectKey", "libraryAddedAt", "chronologicalAt"
);
