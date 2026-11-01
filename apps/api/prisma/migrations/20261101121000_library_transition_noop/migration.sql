CREATE OR REPLACE FUNCTION retire_trashed_media_jobs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Metadata-only batches cannot introduce a trash transition. Avoid joining
  -- both unindexed transition relations when all new rows remain active.
  IF NOT EXISTS (SELECT 1 FROM new_assets WHERE "deletedAt" IS NOT NULL) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM new_assets a JOIN old_assets previous_asset ON previous_asset.id=a.id
    WHERE previous_asset."deletedAt" IS NULL AND a."deletedAt" IS NOT NULL) THEN RETURN NULL; END IF;
  UPDATE "EagleMediaJob" j SET status='COMPLETED',"completedAt"=now(),"lockedAt"=NULL,
    "leaseVersion"=j."leaseVersion"+1,"lastError"='ASSET_TRASHED',"updatedAt"=now()
  FROM new_assets a JOIN old_assets previous_asset ON previous_asset.id=a.id AND previous_asset."ownerId"=a."ownerId" AND previous_asset."libraryMode"=a."libraryMode"
  WHERE previous_asset."deletedAt" IS NULL AND a."deletedAt" IS NOT NULL
    AND j."assetId"=a.id AND j."ownerId"=a."ownerId" AND j."libraryMode"=a."libraryMode"
    AND j.status IN ('PENDING','PROCESSING') AND j.kind<>'PURGE_ASSET';
  RETURN NULL;
END;
$$;
