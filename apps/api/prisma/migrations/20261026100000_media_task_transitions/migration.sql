-- Existing queues stay authoritative. Do not backfill synthetic execution history.
ALTER TABLE "EagleMediaJob" ADD COLUMN "recoveryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EagleMediaJob" ADD CONSTRAINT "EagleMediaJob_recoveryCount_check" CHECK ("recoveryCount">=0);
CREATE TABLE "EagleMediaJobEvent" (
  id BIGSERIAL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "libraryMode" "LibraryMode" NOT NULL,
  "jobId" TEXT NOT NULL,
  "fromStatus" "EagleMediaJobStatus",
  "toStatus" "EagleMediaJobStatus" NOT NULL,
  "leaseVersion" INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  "recoveryCount" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EagleMediaJobEvent_ownerId_libraryMode_jobId_fkey" FOREIGN KEY ("ownerId","libraryMode","jobId")
    REFERENCES "EagleMediaJob" ("ownerId","libraryMode",id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EagleMediaJobEvent_ownerId_libraryMode_jobId_id_idx" ON "EagleMediaJobEvent" ("ownerId","libraryMode","jobId",id);
-- A trigger covers all existing publishers, retries and invalidations atomically;
-- heartbeat-only writes do not create events, and rolled-back publications leave none.
CREATE FUNCTION record_eagle_media_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.status=NEW.status AND OLD."leaseVersion"=NEW."leaseVersion" THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO "EagleMediaJobEvent" ("ownerId","libraryMode","jobId","fromStatus","toStatus","leaseVersion",attempts,"recoveryCount")
    VALUES (NEW."ownerId",NEW."libraryMode",NEW.id,CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,
      NEW.status,NEW."leaseVersion",NEW.attempts,NEW."recoveryCount");
  RETURN NEW;
END;
$$;
CREATE TRIGGER eagle_media_transition AFTER INSERT OR UPDATE OF status,"leaseVersion" ON "EagleMediaJob"
  FOR EACH ROW EXECUTE FUNCTION record_eagle_media_transition();

CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleMediaJobEvent"
  FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
