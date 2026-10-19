-- Retire historical facts without regenerating user images or changing originals.
UPDATE "EagleAssetColorAnalysis" fact SET "isCurrent"=false
FROM "EagleAsset" asset WHERE fact."assetId"=asset.id AND fact."assetRevision"<>asset."mediaRevision" AND fact."isCurrent";
UPDATE "EagleAssetEmbedding" fact SET "isCurrent"=false
FROM "EagleAsset" asset WHERE fact."assetId"=asset.id AND fact."assetRevision"<>asset."mediaRevision" AND fact."isCurrent";
UPDATE "EagleAssetAiTag" link SET status='HIDDEN'
FROM "EagleAiAnalysisRun" run, "EagleAsset" asset
WHERE run.id=link."analysisRunId" AND asset.id=link."assetId" AND run."assetRevision"<>asset."mediaRevision" AND link.status='ACTIVE';
UPDATE "EagleMediaJob" job SET status='COMPLETED', "leaseVersion"="leaseVersion"+1,
  "completedAt"=now(), "lockedAt"=NULL, "lastError"='SUPERSEDED_MEDIA_REVISION'
FROM "EagleAsset" asset WHERE job."assetId"=asset.id AND job."assetRevision"<>asset."mediaRevision"
  AND job.kind<>'PURGE_ASSET' AND job.status IN ('PENDING','PROCESSING');
INSERT INTO "EagleManualTagGroupMembership" ("ownerId","libraryMode","tagId","groupId")
SELECT "ownerId","libraryMode",id,"groupId" FROM "EagleManualTag" WHERE "groupId" IS NOT NULL ON CONFLICT DO NOTHING;
