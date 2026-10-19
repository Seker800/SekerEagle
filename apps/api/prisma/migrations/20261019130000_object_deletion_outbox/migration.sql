CREATE TABLE "EagleObjectDeletion" (
  "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL,
  "libraryMode" "LibraryMode" NOT NULL, "objectKeys" TEXT[] NOT NULL,
  "prefixes" TEXT[] NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "lockedAt" TIMESTAMP(3), "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "EagleObjectDeletion_status_availableAt_idx" ON "EagleObjectDeletion"("status", "availableAt");
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleObjectDeletion" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
