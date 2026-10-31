BEGIN;

-- A trash transition is shared by all entry points. In-flight publishers lose their lease;
-- successful work and failed diagnostics are retained, and physical purge must still run.
CREATE FUNCTION retire_trashed_media_jobs() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "EagleMediaJob" SET status='COMPLETED',"completedAt"=now(),"lockedAt"=NULL,
    "leaseVersion"="leaseVersion"+1,"lastError"='ASSET_TRASHED',"updatedAt"=now()
  WHERE "assetId"=NEW.id AND "ownerId"=NEW."ownerId" AND "libraryMode"=NEW."libraryMode"
    AND status IN ('PENDING','PROCESSING') AND kind<>'PURGE_ASSET';
  RETURN NEW;
END;
$$;
CREATE TRIGGER eagle_trash_media_jobs AFTER UPDATE OF "deletedAt" ON "EagleAsset"
  FOR EACH ROW WHEN (OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL)
  EXECUTE FUNCTION retire_trashed_media_jobs();

-- Reconcile old orphaned work once, preserving task rows and transition history.
UPDATE "EagleMediaJob" j SET status='COMPLETED',"completedAt"=now(),"lockedAt"=NULL,
  "leaseVersion"=j."leaseVersion"+1,"lastError"='ASSET_TRASHED',"updatedAt"=now()
FROM "EagleAsset" a WHERE a.id=j."assetId" AND a."ownerId"=j."ownerId" AND a."libraryMode"=j."libraryMode"
  AND a."deletedAt" IS NOT NULL AND j.status IN ('PENDING','PROCESSING') AND j.kind<>'PURGE_ASSET';

COMMIT;
