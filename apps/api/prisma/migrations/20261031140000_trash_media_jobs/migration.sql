BEGIN;

-- A trash transition is shared by all entry points. In-flight publishers lose their lease;
-- successful work and failed diagnostics are retained, and physical purge must still run.
CREATE FUNCTION retire_trashed_media_jobs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
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
CREATE TRIGGER eagle_trash_media_jobs AFTER UPDATE ON "EagleAsset"
  REFERENCING OLD TABLE AS old_assets NEW TABLE AS new_assets FOR EACH STATEMENT
  EXECUTE FUNCTION retire_trashed_media_jobs();

-- Reconcile old orphaned work once, preserving task rows and transition history.
UPDATE "EagleMediaJob" j SET status='COMPLETED',"completedAt"=now(),"lockedAt"=NULL,
  "leaseVersion"=j."leaseVersion"+1,"lastError"='ASSET_TRASHED',"updatedAt"=now()
FROM "EagleAsset" a WHERE a.id=j."assetId" AND a."ownerId"=j."ownerId" AND a."libraryMode"=j."libraryMode"
  AND a."deletedAt" IS NOT NULL AND j.status IN ('PENDING','PROCESSING') AND j.kind<>'PURGE_ASSET';

COMMIT;
