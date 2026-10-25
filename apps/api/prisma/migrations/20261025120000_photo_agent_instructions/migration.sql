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
CREATE TABLE "EagleAssetTransferFacts" (
 "ownerId" TEXT NOT NULL,
 "libraryMode" "LibraryMode" NOT NULL,
 "assetId" TEXT NOT NULL,
 "assetRevision" INTEGER NOT NULL,
 "schemaVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("schemaVersion"=1),
 "photoMetadata" JSONB,
 "photoLocation" JSONB,
 "editRecipe" JSONB,
 "detailsReady" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("ownerId","libraryMode","assetId"),
 FOREIGN KEY ("ownerId","libraryMode","assetId") REFERENCES "EagleAsset"("ownerId","libraryMode",id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetTransferFacts" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
COMMIT;
