BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "EaglePhotoAgentTask" ADD COLUMN number INTEGER;
WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY "ownerId", "libraryMode" ORDER BY "createdAt",id)::integer AS n FROM "EaglePhotoAgentTask") UPDATE "EaglePhotoAgentTask" t SET number=n.n FROM numbered n WHERE n.id=t.id;
ALTER TABLE "EaglePhotoAgentTask" ALTER COLUMN number SET NOT NULL, ADD CONSTRAINT photo_agent_task_number_positive CHECK(number>0);
CREATE UNIQUE INDEX "EaglePhotoAgentTask_ownerId_libraryMode_number_key" ON "EaglePhotoAgentTask"("ownerId","libraryMode",number);
ALTER TABLE "EaglePhotoAgentSuggestion" ADD COLUMN number INTEGER;
WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY "taskId" ORDER BY "createdAt",id)::integer AS n FROM "EaglePhotoAgentSuggestion") UPDATE "EaglePhotoAgentSuggestion" s SET number=n.n FROM numbered n WHERE n.id=s.id;
ALTER TABLE "EaglePhotoAgentSuggestion" ALTER COLUMN number SET NOT NULL, ADD CONSTRAINT photo_agent_suggestion_number_positive CHECK(number>0);
CREATE UNIQUE INDEX "EaglePhotoAgentSuggestion_taskId_number_key" ON "EaglePhotoAgentSuggestion"("taskId",number);
CREATE FUNCTION assign_photo_agent_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.number IS DISTINCT FROM OLD.number OR NEW."ownerId" IS DISTINCT FROM OLD."ownerId" THEN RAISE EXCEPTION 'photo agent reference is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='EaglePhotoAgentTask' THEN
  PERFORM pg_advisory_xact_lock(hashtext('photo-agent-number:' || NEW."ownerId"));
  SELECT COALESCE(MAX(number),0)+1 INTO NEW.number FROM "EaglePhotoAgentTask" WHERE "ownerId"=NEW."ownerId" AND "libraryMode"=NEW."libraryMode";
 ELSE
  PERFORM pg_advisory_xact_lock(hashtext('photo-agent-item-number:' || NEW."taskId"));
  SELECT COALESCE(MAX(number),0)+1 INTO NEW.number FROM "EaglePhotoAgentSuggestion" WHERE "taskId"=NEW."taskId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER photo_agent_task_number BEFORE INSERT OR UPDATE OF number,"ownerId" ON "EaglePhotoAgentTask" FOR EACH ROW EXECUTE FUNCTION assign_photo_agent_number();
CREATE TRIGGER photo_agent_suggestion_number BEFORE INSERT OR UPDATE OF number,"ownerId" ON "EaglePhotoAgentSuggestion" FOR EACH ROW EXECUTE FUNCTION assign_photo_agent_number();
ALTER TABLE "EaglePhotoAgentEvent" DROP CONSTRAINT "EaglePhotoAgentEvent_action_check";
ALTER TABLE "EaglePhotoAgentEvent" ADD CONSTRAINT "EaglePhotoAgentEvent_action_check" CHECK (action IN ('PROPOSED','REJECTED','EXECUTED','EXECUTION_STARTED','EXECUTION_FAILED','UNDONE','CANCELLED','REVIEW_FAILED','UNDO_FAILED','MANUAL_STARTED','MANUAL_EXECUTED','MANUAL_FAILED'));
CREATE UNIQUE INDEX photo_agent_manual_start ON "EaglePhotoAgentEvent"("ownerId","libraryMode","taskId",(details->>'operationId')) WHERE action='MANUAL_STARTED';
CREATE UNIQUE INDEX photo_agent_manual_done ON "EaglePhotoAgentEvent"("ownerId","libraryMode","taskId",(details->>'operationId')) WHERE action='MANUAL_EXECUTED';
COMMIT;
