BEGIN;
-- CreateTable
CREATE TABLE "EaglePhotoAgentTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "scope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaglePhotoAgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaglePhotoAgentSuggestion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "taskId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "assetRowVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "operation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "EaglePhotoAgentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EaglePhotoLocation" (
    "assetId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL DEFAULT 'PHOTO',
    "assetRevision" INTEGER NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'INFERRED',
    "suggestionId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EaglePhotoLocation_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE INDEX "EaglePhotoAgentTask_ownerId_libraryMode_createdAt_id_idx" ON "EaglePhotoAgentTask"("ownerId", "libraryMode", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoAgentTask_ownerId_libraryMode_id_key" ON "EaglePhotoAgentTask"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EaglePhotoAgentSuggestion_ownerId_libraryMode_assetId_asset_idx" ON "EaglePhotoAgentSuggestion"("ownerId", "libraryMode", "assetId", "assetRevision", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoAgentSuggestion_taskId_assetId_key" ON "EaglePhotoAgentSuggestion"("taskId", "assetId");

-- CreateIndex
CREATE INDEX "EaglePhotoLocation_ownerId_libraryMode_cityId_idx" ON "EaglePhotoLocation"("ownerId", "libraryMode", "cityId");

-- CreateIndex
CREATE UNIQUE INDEX "EaglePhotoLocation_ownerId_libraryMode_assetId_key" ON "EaglePhotoLocation"("ownerId", "libraryMode", "assetId");

-- AddForeignKey
ALTER TABLE "EaglePhotoAgentSuggestion" ADD CONSTRAINT "EaglePhotoAgentSuggestion_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoAgentSuggestion" ADD CONSTRAINT "EaglePhotoAgentSuggestion_ownerId_libraryMode_taskId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "taskId") REFERENCES "EaglePhotoAgentTask"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EaglePhotoLocation" ADD CONSTRAINT "EaglePhotoLocation_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "EaglePhotoAgentTask" ADD CONSTRAINT "photo_agent_task_mode" CHECK ("libraryMode"='PHOTO'), ADD CONSTRAINT "photo_agent_task_kind" CHECK (kind IN ('CITY','NON_PHOTO')), ADD CONSTRAINT "photo_agent_task_status" CHECK (status IN ('OPEN','CANCELLED'));
ALTER TABLE "EaglePhotoAgentSuggestion" ADD CONSTRAINT "photo_agent_suggestion_mode" CHECK ("libraryMode"='PHOTO'), ADD CONSTRAINT "photo_agent_suggestion_kind" CHECK (kind IN ('CITY','NON_PHOTO')), ADD CONSTRAINT "photo_agent_suggestion_status" CHECK (status IN ('PENDING','ACCEPTED','REJECTED','UNDONE'));
ALTER TABLE "EaglePhotoLocation" ADD CONSTRAINT "photo_location_mode" CHECK ("libraryMode"='PHOTO'), ADD CONSTRAINT "photo_location_coordinates" CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180), ADD CONSTRAINT "photo_location_source" CHECK (source IN ('INFERRED','MANUAL'));
CREATE TRIGGER "photo_agent_task_mode_immutable" BEFORE UPDATE OF "libraryMode" ON "EaglePhotoAgentTask" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER "photo_agent_suggestion_mode_immutable" BEFORE UPDATE OF "libraryMode" ON "EaglePhotoAgentSuggestion" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER "photo_location_mode_immutable" BEFORE UPDATE OF "libraryMode" ON "EaglePhotoLocation" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

COMMIT;
