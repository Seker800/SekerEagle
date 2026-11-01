BEGIN;

-- Preserve one durable event per real status/lease transition while amortizing
-- the PL/pgSQL/SPI insert across the entire publisher statement. No backfill:
-- EagleMediaJob remains the only scheduling authority and FK checks stay intact.
DROP TRIGGER IF EXISTS eagle_media_transition ON "EagleMediaJob";
DROP TRIGGER IF EXISTS eagle_media_transition_insert ON "EagleMediaJob";
DROP TRIGGER IF EXISTS eagle_media_transition_update ON "EagleMediaJob";
DROP FUNCTION IF EXISTS record_eagle_media_transition();

CREATE OR REPLACE FUNCTION record_eagle_media_insertions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "EagleMediaJobEvent" ("ownerId","libraryMode","jobId","fromStatus","toStatus","leaseVersion",attempts,"recoveryCount")
  SELECT "ownerId","libraryMode",id,NULL,status,"leaseVersion",attempts,"recoveryCount"
  FROM new_jobs;
  RETURN NULL;
END;
$$;
CREATE TRIGGER eagle_media_transition_insert AFTER INSERT ON "EagleMediaJob"
  REFERENCING NEW TABLE AS new_jobs FOR EACH STATEMENT
  EXECUTE FUNCTION record_eagle_media_insertions();

CREATE OR REPLACE FUNCTION record_eagle_media_updates() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "EagleMediaJobEvent" ("ownerId","libraryMode","jobId","fromStatus","toStatus","leaseVersion",attempts,"recoveryCount")
  SELECT current_job."ownerId",current_job."libraryMode",current_job.id,previous_job.status,
    current_job.status,current_job."leaseVersion",current_job.attempts,current_job."recoveryCount"
  FROM new_jobs current_job JOIN old_jobs previous_job ON previous_job.id=current_job.id
  WHERE (previous_job.status,previous_job."leaseVersion") IS DISTINCT FROM (current_job.status,current_job."leaseVersion");
  RETURN NULL;
END;
$$;
CREATE TRIGGER eagle_media_transition_update AFTER UPDATE ON "EagleMediaJob"
  REFERENCING OLD TABLE AS old_jobs NEW TABLE AS new_jobs FOR EACH STATEMENT
  EXECUTE FUNCTION record_eagle_media_updates();

-- PostgreSQL already coalesces identical transaction notifications. Insert
-- statements can test transition-table membership once, including empty INSERTs.
-- Retain the original UPDATE OF trigger: explicit no-op status updates still
-- wake, and heartbeat-only updates of unrelated columns still remain silent.
DROP TRIGGER IF EXISTS eagle_media_job_worker_wakeup ON "EagleMediaJob";
DROP TRIGGER IF EXISTS eagle_media_job_worker_wakeup_insert ON "EagleMediaJob";
DROP TRIGGER IF EXISTS eagle_media_job_worker_wakeup_update ON "EagleMediaJob";
CREATE OR REPLACE FUNCTION notify_eagle_media_insertions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE resource text;
BEGIN
  FOR resource IN
    SELECT DISTINCT CASE WHEN kind='GENERATE_EMBEDDING' THEN 'EMBEDDING' ELSE 'NAS' END
    FROM new_jobs
  LOOP
    PERFORM pg_notify('sekereagle_worker_wakeup', 'media-ready:' || resource);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER eagle_media_job_worker_wakeup_insert AFTER INSERT ON "EagleMediaJob"
  REFERENCING NEW TABLE AS new_jobs FOR EACH STATEMENT
  EXECUTE FUNCTION notify_eagle_media_insertions();
CREATE TRIGGER eagle_media_job_worker_wakeup_update
  AFTER UPDATE OF status,"availableAt","lockedAt","dependsOnJobId" ON "EagleMediaJob"
  FOR EACH ROW EXECUTE FUNCTION notify_sekereagle_worker_wakeup();

COMMIT;
