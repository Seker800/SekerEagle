-- Only wake-up hints change; business queue, leases and durable commits stay intact.
BEGIN;
-- Old workers still wake on every payload; new workers invalidate candidate hints
-- only when their resource gains work. Existing dependency/status index is reused.
CREATE OR REPLACE FUNCTION notify_sekereagle_worker_wakeup()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE resource text;
BEGIN
  IF TG_TABLE_NAME='EagleMediaJob' THEN
    -- Claims and forward lease heartbeats add no runnable work. NOTIFY holds
    -- a global commit-order lock; omitting those broadcasts permits WAL group commit.
    IF TG_OP='UPDATE' THEN
      IF NEW.status='PROCESSING' AND OLD.status IN ('PENDING','PROCESSING')
        AND NEW."lockedAt" IS NOT NULL
        AND (OLD."lockedAt" IS NULL OR NEW."lockedAt">=OLD."lockedAt")
        AND NEW."availableAt" IS NOT DISTINCT FROM OLD."availableAt"
        AND NEW."dependsOnJobId" IS NOT DISTINCT FROM OLD."dependsOnJobId" THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_OP='INSERT' OR NEW.status='PENDING' THEN
      resource := CASE WHEN NEW.kind='GENERATE_EMBEDDING' THEN 'EMBEDDING' ELSE 'NAS' END;
      PERFORM pg_notify('sekereagle_worker_wakeup', 'media-ready:' || resource);
    ELSIF NEW.status='COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status THEN
      FOR resource IN
        SELECT DISTINCT CASE WHEN kind='GENERATE_EMBEDDING' THEN 'EMBEDDING' ELSE 'NAS' END
        FROM "EagleMediaJob" WHERE "dependsOnJobId"=NEW.id AND "ownerId"=NEW."ownerId"
          AND "libraryMode"=NEW."libraryMode" AND status='PENDING'
      LOOP
        PERFORM pg_notify('sekereagle_worker_wakeup', 'media-ready:' || resource);
      END LOOP;
      PERFORM pg_notify('sekereagle_worker_wakeup', 'media-progress');
    ELSE
      PERFORM pg_notify('sekereagle_worker_wakeup', 'media-progress');
    END IF;
  ELSE
    PERFORM pg_notify('sekereagle_worker_wakeup', TG_TABLE_NAME);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMIT;
