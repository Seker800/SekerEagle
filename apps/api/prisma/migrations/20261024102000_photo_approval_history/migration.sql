CREATE TABLE "EaglePhotoAgentEvent" (
 "id" TEXT PRIMARY KEY,
 "ownerId" TEXT NOT NULL,
 "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
 "taskId" TEXT NOT NULL,
 "suggestionId" TEXT,
 "assetId" TEXT,
 "actor" TEXT NOT NULL CHECK ("actor" IN ('AGENT','HUMAN','SYSTEM')),
 "action" TEXT NOT NULL CHECK ("action" IN ('PROPOSED','REJECTED','EXECUTED','EXECUTION_STARTED','EXECUTION_FAILED','UNDONE','CANCELLED','REVIEW_FAILED','UNDO_FAILED')),
 "details" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "photo_event_task_scope_fkey" FOREIGN KEY ("ownerId","libraryMode","taskId") REFERENCES "EaglePhotoAgentTask"("ownerId","libraryMode","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "photo_event_mode" CHECK ("libraryMode"='PHOTO')
);
CREATE INDEX "EaglePhotoAgentEvent_ownerId_libraryMode_taskId_createdAt_id_idx" ON "EaglePhotoAgentEvent"("ownerId","libraryMode","taskId","createdAt","id");
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoAgentEvent" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE FUNCTION prevent_photo_agent_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Photo approval history is append-only'; END;
$$;
CREATE TRIGGER photo_agent_event_append_only BEFORE UPDATE OR DELETE ON "EaglePhotoAgentEvent" FOR EACH ROW EXECUTE FUNCTION prevent_photo_agent_event_mutation();
-- Existing decisions remain visible after upgrade, with an explicit legacy snapshot marker.
INSERT INTO "EaglePhotoAgentEvent" ("id","ownerId","libraryMode","taskId","suggestionId","assetId","actor","action","details","createdAt")
SELECT gen_random_uuid()::text,"ownerId","libraryMode","taskId","id","assetId",'SYSTEM',
 CASE "status" WHEN 'ACCEPTED' THEN 'EXECUTED' WHEN 'REJECTED' THEN 'REJECTED' WHEN 'UNDONE' THEN 'UNDONE' WHEN 'FAILED' THEN 'EXECUTION_FAILED' WHEN 'APPLYING' THEN 'EXECUTION_STARTED' ELSE 'PROPOSED' END,
 jsonb_build_object('legacySnapshot',true,'kind',"kind",'value',"value",'operation',"operation",'assetRevision',"assetRevision",'assetRowVersion',"assetRowVersion"),COALESCE("reviewedAt","createdAt")
FROM "EaglePhotoAgentSuggestion";
