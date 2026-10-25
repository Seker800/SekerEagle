BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE TABLE "EaglePhotoAgentPreference" (
 "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
 instructions TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("ownerId", "libraryMode"),
 CONSTRAINT photo_agent_preference_mode CHECK ("libraryMode"='PHOTO'),
 CONSTRAINT photo_agent_preference_revision CHECK (revision > 0),
 CONSTRAINT photo_agent_preference_size CHECK (char_length(instructions) <= 8000)
);
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePhotoAgentPreference" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
ALTER TABLE "EaglePhotoAgentSuggestion" ADD COLUMN "reviewBasis" TEXT NOT NULL DEFAULT 'VISUAL';
ALTER TABLE "EaglePhotoAgentSuggestion" ADD CONSTRAINT photo_agent_review_basis CHECK ("reviewBasis" IN ('VISUAL','METADATA'));
COMMIT;
