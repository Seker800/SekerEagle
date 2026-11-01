-- Color facts are derived data. Keep originals and historical analyses; rebuild only
-- current image revisions with a ready thumbnail through the existing background queue.
-- Normal worker privacy, pause, schedule and lease guards remain authoritative.
UPDATE "EagleMediaJob" SET status='COMPLETED',"leaseVersion"="leaseVersion"+1,
  "completedAt"=now(),"lockedAt"=NULL,"updatedAt"=now(),"lastError"='SUPERSEDED_COLOR_PROCESSOR_VERSION'
WHERE kind='EXTRACT_COLOR_PALETTE' AND "processorVersion"<>'color-v4-eagle-basic'
  AND status IN ('PENDING','PROCESSING','FAILED');

INSERT INTO "EagleMediaJob" (id,"ownerId","libraryMode","assetId",kind,lane,"assetRevision","processorVersion","updatedAt")
SELECT gen_random_uuid()::text,asset."ownerId",asset."libraryMode",asset.id,
  'EXTRACT_COLOR_PALETTE','BACKGROUND',asset."mediaRevision",'color-v4-eagle-basic',now()
FROM "EagleAsset" asset
WHERE asset."deletedAt" IS NULL AND asset."mimeType" LIKE 'image/%'
  AND EXISTS (SELECT 1 FROM "EagleAssetRendition" rendition
    WHERE rendition."assetId"=asset.id AND rendition."ownerId"=asset."ownerId" AND rendition."libraryMode"=asset."libraryMode"
      AND rendition.revision=asset."mediaRevision" AND rendition.kind='THUMBNAIL' AND rendition.status='READY')
  AND NOT EXISTS (SELECT 1 FROM "EagleAssetColorAnalysis" analysis
    WHERE analysis."assetId"=asset.id AND analysis."ownerId"=asset."ownerId" AND analysis."libraryMode"=asset."libraryMode"
      AND analysis."assetRevision"=asset."mediaRevision" AND analysis."processorVersion"='color-v4-eagle-basic'
      AND analysis."isCurrent" AND analysis.status='COMPLETED')
ON CONFLICT ("assetId",kind,"assetRevision","processorVersion") DO NOTHING;
