CREATE OR REPLACE FUNCTION notify_sekereagle_worker_wakeup()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('sekereagle_worker_wakeup', TG_TABLE_NAME);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER eagle_media_job_worker_wakeup
AFTER INSERT OR UPDATE OF status, "availableAt", "lockedAt", "dependsOnJobId"
ON "EagleMediaJob"
FOR EACH ROW
EXECUTE FUNCTION notify_sekereagle_worker_wakeup();

CREATE TRIGGER eagle_tag_semantic_build_worker_wakeup
AFTER INSERT OR UPDATE OF status, "availableAt", "lockedAt"
ON "EagleTagSemanticBuild"
FOR EACH ROW
EXECUTE FUNCTION notify_sekereagle_worker_wakeup();

CREATE TRIGGER eagle_processing_setting_worker_wakeup
AFTER INSERT OR UPDATE OR DELETE
ON "EagleProcessingSetting"
FOR EACH ROW
EXECUTE FUNCTION notify_sekereagle_worker_wakeup();
