ALTER TYPE "EagleMediaJobKind" ADD VALUE 'RENDER_EDITED_COPY';
CREATE TABLE "EagleEditRender" (
 "jobId" TEXT PRIMARY KEY,
 "ownerId" TEXT NOT NULL,
 "libraryMode" "LibraryMode" NOT NULL,
 "requestId" TEXT NOT NULL,
 "sourceRowVersion" INTEGER NOT NULL,
 "recipe" JSONB NOT NULL,
 "lut" TEXT,
 "resultAssetId" TEXT,
 CONSTRAINT "EagleEditRender_job_fkey" FOREIGN KEY ("ownerId","libraryMode","jobId") REFERENCES "EagleMediaJob"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "EagleEditRender_result_fkey" FOREIGN KEY ("ownerId","libraryMode","resultAssetId") REFERENCES "EagleAsset"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EagleEditRender_ownerId_libraryMode_requestId_key" ON "EagleEditRender"("ownerId","libraryMode","requestId");

CREATE UNIQUE INDEX "EagleEditRender_ownerId_libraryMode_jobId_key" ON "EagleEditRender"("ownerId", "libraryMode", "jobId");
