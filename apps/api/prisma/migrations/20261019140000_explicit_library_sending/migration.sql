CREATE TABLE "EagleLibraryTransfer" (
 "id" TEXT NOT NULL PRIMARY KEY, "ownerId" TEXT NOT NULL,
 "sourceMode" "LibraryMode" NOT NULL, "targetMode" "LibraryMode" NOT NULL,
 "sourceIds" TEXT[] NOT NULL, "plan" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "result" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EagleLibraryTransfer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EagleLibraryTransfer_modes_check" CHECK ("sourceMode" <> "targetMode"),
 CONSTRAINT "EagleLibraryTransfer_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED'))
);
CREATE INDEX "EagleLibraryTransfer_ownerId_sourceMode_status_updatedAt_idx" ON "EagleLibraryTransfer"("ownerId","sourceMode","status","updatedAt");
