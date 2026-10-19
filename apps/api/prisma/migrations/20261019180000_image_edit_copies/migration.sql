CREATE TABLE "EagleImageEdit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "libraryMode" "LibraryMode" NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceRowVersion" INTEGER NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "recipe" JSONB NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleImageEdit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EagleImageEdit_targetId_key" ON "EagleImageEdit"("targetId");
CREATE UNIQUE INDEX "EagleImageEdit_targetKey_key" ON "EagleImageEdit"("targetKey");
CREATE INDEX "EagleImageEdit_ownerId_libraryMode_status_updatedAt_idx" ON "EagleImageEdit"("ownerId", "libraryMode", "status", "updatedAt");
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImageEdit" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
