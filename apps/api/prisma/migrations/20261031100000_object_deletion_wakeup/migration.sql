BEGIN;
CREATE FUNCTION notify_sekereagle_object_deletion_ready() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status=NEW.status
      AND OLD."availableAt" IS NOT DISTINCT FROM NEW."availableAt" THEN
    RETURN NEW;
  END IF;
  IF NEW.status='PENDING' AND NEW."availableAt"<=clock_timestamp() THEN
    -- Constant payloads coalesce within a transaction. Never wake media discovery.
    PERFORM pg_notify('sekereagle_object_deletion_wakeup', 'ready');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER eagle_object_deletion_ready_wakeup
AFTER INSERT OR UPDATE OF status, "availableAt" ON "EagleObjectDeletion"
FOR EACH ROW EXECUTE FUNCTION notify_sekereagle_object_deletion_ready();
COMMIT;
