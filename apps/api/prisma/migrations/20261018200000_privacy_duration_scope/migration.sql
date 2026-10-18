BEGIN;
-- AlterTable
ALTER TABLE "EaglePrivacyPreference" DROP CONSTRAINT "EaglePrivacyPreference_pkey",
ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL',
ADD CONSTRAINT "EaglePrivacyPreference_pkey" PRIMARY KEY ("ownerId", "libraryMode");


CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EaglePrivacyPreference" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

COMMIT;
