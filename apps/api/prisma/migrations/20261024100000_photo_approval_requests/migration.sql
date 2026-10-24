ALTER TABLE "EaglePhotoAgentTask" ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "EaglePhotoAgentTask" ADD COLUMN "title" TEXT, ADD COLUMN "rationale" TEXT;
ALTER TABLE "EaglePhotoLocation" ADD COLUMN "precision" TEXT NOT NULL DEFAULT 'CITY', ADD COLUMN "accuracyMeters" DOUBLE PRECISION;
ALTER TABLE "EaglePhotoLocation" ADD CONSTRAINT "EaglePhotoLocation_precision_check" CHECK ("precision" IN ('CITY','EXACT') AND ("precision" <> 'EXACT' OR ("accuracyMeters" IS NOT NULL AND "accuracyMeters" > 0 AND "accuracyMeters" <= 10000)));
ALTER TABLE "EaglePhotoAgentTask" DROP CONSTRAINT "photo_agent_task_kind", ADD CONSTRAINT "photo_agent_task_kind" CHECK (kind IN ('CITY','NON_PHOTO','SEND_TO_MATERIAL','DELETE'));
ALTER TABLE "EaglePhotoAgentSuggestion" DROP CONSTRAINT "photo_agent_suggestion_kind", ADD CONSTRAINT "photo_agent_suggestion_kind" CHECK (kind IN ('CITY','NON_PHOTO','SEND_TO_MATERIAL','DELETE'));
ALTER TABLE "EaglePhotoAgentSuggestion" DROP CONSTRAINT "photo_agent_suggestion_status", ADD CONSTRAINT "photo_agent_suggestion_status" CHECK (status IN ('PENDING','APPLYING','FAILED','ACCEPTED','REJECTED','UNDONE'));
