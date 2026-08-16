-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- Required by owner-scoped fuzzy search indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('EAGLE_ASSET');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('INITIATED', 'ASSEMBLED', 'FINALIZING', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "EagleAssetLifecycleStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "EagleRenditionKind" AS ENUM ('THUMBNAIL', 'PREVIEW', 'POSTER');

-- CreateEnum
CREATE TYPE "EagleRenditionStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "EagleAiAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EagleAiTagStatus" AS ENUM ('ACTIVE', 'HIDDEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "EagleMediaJobKind" AS ENUM ('GENERATE_RENDITIONS', 'GENERATE_THUMBNAIL', 'GENERATE_PREVIEW', 'PROBE_MEDIA', 'EXTRACT_COLOR_PALETTE', 'PURGE_ASSET');

-- CreateEnum
CREATE TYPE "EagleMediaJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EagleProcessingLane" AS ENUM ('INTERACTIVE', 'BACKGROUND', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "EagleColorAnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "EagleExternalProvider" AS ENUM ('EAGLE_APP');

-- CreateEnum
CREATE TYPE "EagleImportRunStatus" AS ENUM ('DRAFT', 'PREFLIGHTED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EagleImportItemStatus" AS ENUM ('STAGED', 'UPLOADING', 'FINALIZING', 'IMPORTED', 'SKIPPED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EagleImportItemAction" AS ENUM ('NEW', 'UNCHANGED', 'METADATA_UPDATE', 'CONTENT_REPLACE', 'SKIP_DELETED', 'SKIP_UNSUPPORTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "authVersion" INTEGER NOT NULL DEFAULT 0,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "kind" "UploadKind" NOT NULL DEFAULT 'EAGLE_ASSET',
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'INITIATED',
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "multipartUploadId" TEXT NOT NULL,
    "completionParts" JSONB,
    "uploaderId" TEXT NOT NULL,
    "eagleAssetId" TEXT,
    "eagleDuplicatePolicy" TEXT,
    "objectCleanupPending" BOOLEAN NOT NULL DEFAULT false,
    "assembledAt" TIMESTAMP(3),
    "finalizationStartedAt" TIMESTAMP(3),
    "finalizationAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizationMode" TEXT,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadFinalizationJob" (
    "id" TEXT NOT NULL,
    "uploadSessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseVersion" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadFinalizationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleUploadSessionState" (
    "uploadSessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "duplicatePolicy" TEXT NOT NULL DEFAULT 'SKIP',
    "assetId" TEXT,
    "replacementAssetId" TEXT,
    "expectedContentSha256" TEXT,
    "retiredObjectKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleUploadSessionState_pkey" PRIMARY KEY ("uploadSessionId")
);

-- CreateTable
CREATE TABLE "EagleAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedDisplayName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "originalObjectKey" TEXT NOT NULL,
    "lifecycleStatus" "EagleAssetLifecycleStatus" NOT NULL DEFAULT 'PROCESSING',
    "mediaErrorCode" TEXT,
    "mediaRevision" INTEGER NOT NULL DEFAULT 0,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "rating" INTEGER,
    "libraryAddedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "purgeAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAssetAnnotation" (
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAssetAnnotation_pkey" PRIMARY KEY ("ownerId","assetId")
);

-- CreateTable
CREATE TABLE "EagleExternalLibrary" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" "EagleExternalProvider" NOT NULL DEFAULT 'EAGLE_APP',
    "externalLibraryId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleExternalLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleExternalAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "externalLibraryId" TEXT NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "assetId" TEXT,
    "sourceImportedAt" TIMESTAMP(3),
    "sourceModifiedAt" TIMESTAMP(3),
    "metadataVersion" INTEGER NOT NULL DEFAULT 1,
    "metadataHash" TEXT,
    "sourceContentSha256" TEXT,
    "sourceFileModifiedAt" TIMESTAMP(3),
    "sourceByteSize" BIGINT,
    "lastSeenAt" TIMESTAMP(3),
    "lastImportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleExternalAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "externalLibraryId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "declarationHash" TEXT,
    "manifestVersion" INTEGER NOT NULL,
    "status" "EagleImportRunStatus" NOT NULL DEFAULT 'DRAFT',
    "declaredItemCount" INTEGER NOT NULL DEFAULT 0,
    "declaredByteSize" BIGINT NOT NULL DEFAULT 0,
    "stagedItemCount" INTEGER NOT NULL DEFAULT 0,
    "importedItemCount" INTEGER NOT NULL DEFAULT 0,
    "skippedItemCount" INTEGER NOT NULL DEFAULT 0,
    "failedItemCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportManifestChunk" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chunkKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "acceptedItemCount" INTEGER NOT NULL,
    "skippedItemCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleImportManifestChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportRunItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalAssetId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sourceImportedAt" TIMESTAMP(3),
    "sourceModifiedAt" TIMESTAMP(3),
    "rating" INTEGER,
    "description" TEXT,
    "sourceUrl" TEXT,
    "tagNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "folderSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadataHash" TEXT NOT NULL,
    "action" "EagleImportItemAction",
    "contentSha256" TEXT,
    "sourceFileModifiedAt" TIMESTAMP(3),
    "warningCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EagleImportItemStatus" NOT NULL DEFAULT 'STAGED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "assetId" TEXT,
    "activeUploadSessionId" TEXT,
    "terminalProgressAppliedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImportRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportFolderDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceFolderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentSourceFolderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImportFolderDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportTagDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "groupSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImportTagDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleImportTagGroupDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleImportTagGroupDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAssetRendition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "EagleRenditionKind" NOT NULL,
    "revision" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "status" "EagleRenditionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAssetRendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleManualTag" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "groupId" TEXT,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleManualTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleManualTagGroup" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "description" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleManualTagGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleManualTagGroupMembership" (
    "ownerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleManualTagGroupMembership_pkey" PRIMARY KEY ("ownerId","tagId","groupId")
);

-- CreateTable
CREATE TABLE "EagleAssetManualTag" (
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "assignedByUser" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleAssetManualTag_pkey" PRIMARY KEY ("ownerId","assetId","tagId")
);

-- CreateTable
CREATE TABLE "EagleAssetManualTagIngestion" (
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleAssetManualTagIngestion_pkey" PRIMARY KEY ("ownerId","assetId","tagId","sourceKey")
);

-- CreateTable
CREATE TABLE "EagleAiAnalysisRun" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "promptVersion" TEXT NOT NULL,
    "status" "EagleAiAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAiAnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAiTag" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAiTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAssetAiTag" (
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "aiTagId" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "EagleAiTagStatus" NOT NULL DEFAULT 'ACTIVE',
    "promotedManualTagId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAssetAiTag_pkey" PRIMARY KEY ("ownerId","assetId","aiTagId","analysisRunId")
);

-- CreateTable
CREATE TABLE "EagleSmartFolder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "queryVersion" INTEGER NOT NULL DEFAULT 1,
    "queryJson" JSONB NOT NULL,
    "sortField" TEXT,
    "sortDirection" TEXT,
    "viewMode" TEXT,
    "thumbnailSize" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleSmartFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleSmartFolderManualTagDependency" (
    "ownerId" TEXT NOT NULL,
    "smartFolderId" TEXT NOT NULL,
    "manualTagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleSmartFolderManualTagDependency_pkey" PRIMARY KEY ("ownerId","smartFolderId","manualTagId")
);

-- CreateTable
CREATE TABLE "EagleSmartFolderAiTagDependency" (
    "ownerId" TEXT NOT NULL,
    "smartFolderId" TEXT NOT NULL,
    "aiTagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleSmartFolderAiTagDependency_pkey" PRIMARY KEY ("ownerId","smartFolderId","aiTagId")
);

-- CreateTable
CREATE TABLE "EagleMediaJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "EagleMediaJobKind" NOT NULL,
    "status" "EagleMediaJobStatus" NOT NULL DEFAULT 'PENDING',
    "lane" "EagleProcessingLane" NOT NULL DEFAULT 'INTERACTIVE',
    "assetRevision" INTEGER NOT NULL,
    "processorVersion" TEXT NOT NULL DEFAULT 'v1',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseVersion" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleMediaJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAssetColorAnalysis" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetRevision" INTEGER NOT NULL,
    "processorVersion" TEXT NOT NULL,
    "status" "EagleColorAnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleAssetColorAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleAssetColorSwatch" (
    "ownerId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "hex" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "labL" DOUBLE PRECISION NOT NULL,
    "labA" DOUBLE PRECISION NOT NULL,
    "labB" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EagleAssetColorSwatch_pkey" PRIMARY KEY ("analysisId","rank")
);

-- CreateTable
CREATE TABLE "EagleProcessingWorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleProcessingWorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalAccessToken_tokenHash_key" ON "PersonalAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_userId_revokedAt_expiresAt_idx" ON "PersonalAccessToken"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_objectKey_key" ON "UploadSession"("objectKey");

-- CreateIndex
CREATE INDEX "UploadSession_uploaderId_createdAt_idx" ON "UploadSession"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadSession_status_createdAt_idx" ON "UploadSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "UploadSession_status_updatedAt_idx" ON "UploadSession"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "UploadSession_objectCleanupPending_updatedAt_idx" ON "UploadSession"("objectCleanupPending", "updatedAt");

-- CreateIndex
CREATE INDEX "UploadSession_eagleAssetId_idx" ON "UploadSession"("eagleAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_uploaderId_id_key" ON "UploadSession"("uploaderId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UploadFinalizationJob_uploadSessionId_key" ON "UploadFinalizationJob"("uploadSessionId");

-- CreateIndex
CREATE INDEX "UploadFinalizationJob_status_availableAt_createdAt_idx" ON "UploadFinalizationJob"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "UploadFinalizationJob_status_lockedAt_idx" ON "UploadFinalizationJob"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "EagleUploadSessionState_ownerId_createdAt_idx" ON "EagleUploadSessionState"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "EagleUploadSessionState_assetId_idx" ON "EagleUploadSessionState"("assetId");

-- CreateIndex
CREATE INDEX "EagleUploadSessionState_ownerId_replacementAssetId_idx" ON "EagleUploadSessionState"("ownerId", "replacementAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleUploadSessionState_ownerId_uploadSessionId_key" ON "EagleUploadSessionState"("ownerId", "uploadSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAsset_originalObjectKey_key" ON "EagleAsset"("originalObjectKey");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_deletedAt_libraryAddedAt_id_idx" ON "EagleAsset"("ownerId", "deletedAt", "libraryAddedAt", "id");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_deletedAt_rating_idx" ON "EagleAsset"("ownerId", "deletedAt", "rating");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_normalizedDisplayName_idx" ON "EagleAsset"("ownerId", "normalizedDisplayName");

-- CreateIndex
CREATE INDEX "EagleAsset_normalizedDisplayName_trgm_idx" ON "EagleAsset" USING GIN ("normalizedDisplayName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "EagleAsset_originalName_trgm_idx" ON "EagleAsset" USING GIN ("originalName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_sha256_idx" ON "EagleAsset"("ownerId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAsset_ownerId_id_key" ON "EagleAsset"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleAssetAnnotation_ownerId_updatedAt_idx" ON "EagleAssetAnnotation"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "EagleExternalLibrary_ownerId_updatedAt_idx" ON "EagleExternalLibrary"("ownerId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalLibrary_ownerId_provider_externalLibraryId_key" ON "EagleExternalLibrary"("ownerId", "provider", "externalLibraryId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalLibrary_ownerId_id_key" ON "EagleExternalLibrary"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleExternalAsset_ownerId_externalItemId_idx" ON "EagleExternalAsset"("ownerId", "externalItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_externalLibraryId_externalItemId_key" ON "EagleExternalAsset"("ownerId", "externalLibraryId", "externalItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_assetId_key" ON "EagleExternalAsset"("ownerId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_id_key" ON "EagleExternalAsset"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleImportRun_ownerId_status_updatedAt_idx" ON "EagleImportRun"("ownerId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "EagleImportRun_externalLibraryId_createdAt_idx" ON "EagleImportRun"("externalLibraryId", "createdAt");

-- CreateIndex
CREATE INDEX "EagleImportRun_status_completedAt_idx" ON "EagleImportRun"("status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRun_ownerId_idempotencyKey_key" ON "EagleImportRun"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRun_ownerId_id_key" ON "EagleImportRun"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleImportManifestChunk_ownerId_runId_createdAt_idx" ON "EagleImportManifestChunk"("ownerId", "runId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportManifestChunk_runId_chunkKey_key" ON "EagleImportManifestChunk"("runId", "chunkKey");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRunItem_activeUploadSessionId_key" ON "EagleImportRunItem"("activeUploadSessionId");

-- CreateIndex
CREATE INDEX "EagleImportRunItem_ownerId_runId_status_id_idx" ON "EagleImportRunItem"("ownerId", "runId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRunItem_runId_externalAssetId_key" ON "EagleImportRunItem"("runId", "externalAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRunItem_runId_sourceItemId_key" ON "EagleImportRunItem"("runId", "sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRunItem_ownerId_id_key" ON "EagleImportRunItem"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleImportFolderDefinition_ownerId_runId_idx" ON "EagleImportFolderDefinition"("ownerId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportFolderDefinition_runId_sourceFolderId_key" ON "EagleImportFolderDefinition"("runId", "sourceFolderId");

-- CreateIndex
CREATE INDEX "EagleImportTagDefinition_ownerId_runId_idx" ON "EagleImportTagDefinition"("ownerId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportTagDefinition_runId_normalizedName_key" ON "EagleImportTagDefinition"("runId", "normalizedName");

-- CreateIndex
CREATE INDEX "EagleImportTagGroupDefinition_ownerId_runId_idx" ON "EagleImportTagGroupDefinition"("ownerId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportTagGroupDefinition_runId_sourceGroupId_key" ON "EagleImportTagGroupDefinition"("runId", "sourceGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetRendition_storageKey_key" ON "EagleAssetRendition"("storageKey");

-- CreateIndex
CREATE INDEX "EagleAssetRendition_ownerId_assetId_idx" ON "EagleAssetRendition"("ownerId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetRendition_assetId_kind_revision_key" ON "EagleAssetRendition"("assetId", "kind", "revision");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_name_idx" ON "EagleManualTag"("ownerId", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_groupId_name_idx" ON "EagleManualTag"("ownerId", "groupId", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_isStarred_name_idx" ON "EagleManualTag"("ownerId", "isStarred", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_normalizedName_trgm_idx" ON "EagleManualTag" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTag_ownerId_normalizedName_key" ON "EagleManualTag"("ownerId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTag_ownerId_id_key" ON "EagleManualTag"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleManualTagGroup_ownerId_name_idx" ON "EagleManualTagGroup"("ownerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagGroup_ownerId_normalizedName_key" ON "EagleManualTagGroup"("ownerId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagGroup_ownerId_id_key" ON "EagleManualTagGroup"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleManualTagGroupMembership_ownerId_groupId_tagId_idx" ON "EagleManualTagGroupMembership"("ownerId", "groupId", "tagId");

-- CreateIndex
CREATE INDEX "EagleAssetManualTag_ownerId_tagId_assetId_idx" ON "EagleAssetManualTag"("ownerId", "tagId", "assetId");

-- CreateIndex
CREATE INDEX "EagleAssetManualTagIngestion_ownerId_assetId_sourceKey_idx" ON "EagleAssetManualTagIngestion"("ownerId", "assetId", "sourceKey");

-- CreateIndex
CREATE INDEX "EagleAiAnalysisRun_ownerId_assetId_assetRevision_createdAt_idx" ON "EagleAiAnalysisRun"("ownerId", "assetId", "assetRevision", "createdAt");

-- CreateIndex
CREATE INDEX "EagleAiAnalysisRun_status_createdAt_idx" ON "EagleAiAnalysisRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiAnalysisRun_ownerId_id_key" ON "EagleAiAnalysisRun"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleAiTag_ownerId_name_idx" ON "EagleAiTag"("ownerId", "name");

-- CreateIndex
CREATE INDEX "EagleAiTag_normalizedName_trgm_idx" ON "EagleAiTag" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiTag_ownerId_normalizedName_key" ON "EagleAiTag"("ownerId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiTag_ownerId_id_key" ON "EagleAiTag"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleAssetAiTag_ownerId_aiTagId_assetId_idx" ON "EagleAssetAiTag"("ownerId", "aiTagId", "assetId");

-- CreateIndex
CREATE INDEX "EagleAssetAiTag_ownerId_analysisRunId_idx" ON "EagleAssetAiTag"("ownerId", "analysisRunId");

-- CreateIndex
CREATE INDEX "EagleSmartFolder_ownerId_parentId_position_id_idx" ON "EagleSmartFolder"("ownerId", "parentId", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolder_ownerId_normalizedName_key" ON "EagleSmartFolder"("ownerId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolder_ownerId_id_key" ON "EagleSmartFolder"("ownerId", "id");

-- CreateIndex
CREATE INDEX "EagleSmartFolderManualTagDependency_ownerId_manualTagId_sma_idx" ON "EagleSmartFolderManualTagDependency"("ownerId", "manualTagId", "smartFolderId");

-- CreateIndex
CREATE INDEX "EagleSmartFolderAiTagDependency_ownerId_aiTagId_smartFolder_idx" ON "EagleSmartFolderAiTagDependency"("ownerId", "aiTagId", "smartFolderId");

-- CreateIndex
CREATE INDEX "EagleMediaJob_status_lane_availableAt_idx" ON "EagleMediaJob"("status", "lane", "availableAt");

-- CreateIndex
CREATE INDEX "EagleMediaJob_status_lockedAt_idx" ON "EagleMediaJob"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "EagleMediaJob_ownerId_assetId_idx" ON "EagleMediaJob"("ownerId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleMediaJob_assetId_kind_assetRevision_processorVersion_key" ON "EagleMediaJob"("assetId", "kind", "assetRevision", "processorVersion");

-- CreateIndex
CREATE INDEX "EagleAssetColorAnalysis_ownerId_assetId_assetRevision_idx" ON "EagleAssetColorAnalysis"("ownerId", "assetId", "assetRevision");

-- CreateIndex
CREATE INDEX "EagleAssetColorAnalysis_ownerId_processorVersion_isCurrent__idx" ON "EagleAssetColorAnalysis"("ownerId", "processorVersion", "isCurrent", "status");

-- CreateIndex
CREATE INDEX "EagleAssetColorAnalysis_status_updatedAt_idx" ON "EagleAssetColorAnalysis"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetColorAnalysis_ownerId_id_key" ON "EagleAssetColorAnalysis"("ownerId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetColorAnalysis_assetId_assetRevision_processorVers_key" ON "EagleAssetColorAnalysis"("assetId", "assetRevision", "processorVersion");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_ownerId_analysisId_idx" ON "EagleAssetColorSwatch"("ownerId", "analysisId");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_hex_idx" ON "EagleAssetColorSwatch"("hex");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_ownerId_labL_idx" ON "EagleAssetColorSwatch"("ownerId", "labL");

-- CreateIndex
CREATE INDEX "EagleProcessingWorkerHeartbeat_heartbeatAt_idx" ON "EagleProcessingWorkerHeartbeat"("heartbeatAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAccessToken" ADD CONSTRAINT "PersonalAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_uploaderId_eagleAssetId_fkey" FOREIGN KEY ("uploaderId", "eagleAssetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadFinalizationJob" ADD CONSTRAINT "UploadFinalizationJob_uploadSessionId_fkey" FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_uploadSessionId_fkey" FOREIGN KEY ("ownerId", "uploadSessionId") REFERENCES "UploadSession"("uploaderId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_replacementAssetId_fkey" FOREIGN KEY ("ownerId", "replacementAssetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAsset" ADD CONSTRAINT "EagleAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAnnotation" ADD CONSTRAINT "EagleAssetAnnotation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAnnotation" ADD CONSTRAINT "EagleAssetAnnotation_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalLibrary" ADD CONSTRAINT "EagleExternalLibrary_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalAsset" ADD CONSTRAINT "EagleExternalAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalAsset" ADD CONSTRAINT "EagleExternalAsset_ownerId_externalLibraryId_fkey" FOREIGN KEY ("ownerId", "externalLibraryId") REFERENCES "EagleExternalLibrary"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalAsset" ADD CONSTRAINT "EagleExternalAsset_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE SET NULL ("assetId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRun" ADD CONSTRAINT "EagleImportRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRun" ADD CONSTRAINT "EagleImportRun_ownerId_externalLibraryId_fkey" FOREIGN KEY ("ownerId", "externalLibraryId") REFERENCES "EagleExternalLibrary"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportManifestChunk" ADD CONSTRAINT "EagleImportManifestChunk_ownerId_runId_fkey" FOREIGN KEY ("ownerId", "runId") REFERENCES "EagleImportRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_runId_fkey" FOREIGN KEY ("ownerId", "runId") REFERENCES "EagleImportRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_externalAssetId_fkey" FOREIGN KEY ("ownerId", "externalAssetId") REFERENCES "EagleExternalAsset"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE SET NULL ("assetId") ON UPDATE CASCADE;

-- Domain constraints that Prisma cannot express in the schema.
ALTER TABLE "EagleAsset"
  ADD CONSTRAINT "EagleAsset_rating_check"
  CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));

ALTER TABLE "EagleImportRunItem"
  ADD CONSTRAINT "EagleImportRunItem_rating_check"
  CHECK ("rating" IS NULL OR ("rating" >= 1 AND "rating" <= 5));

ALTER TABLE "UploadSession"
  ADD CONSTRAINT "UploadSession_eagle_duplicate_policy_check"
  CHECK ("eagleDuplicatePolicy" IS NULL OR "eagleDuplicatePolicy" IN ('SKIP', 'CREATE_COPY'));

ALTER TABLE "EagleUploadSessionState"
  ADD CONSTRAINT "EagleUploadSessionState_duplicatePolicy_check"
  CHECK ("duplicatePolicy" IN ('SKIP', 'CREATE_COPY'));

ALTER TABLE "EagleSmartFolder"
  ADD CONSTRAINT "EagleSmartFolder_parent_not_self_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id"),
  ADD CONSTRAINT "EagleSmartFolder_color_check"
  CHECK ("color" IS NULL OR "color" ~ '^#[0-9a-f]{6}$');

ALTER TABLE "EagleExternalAsset"
  ADD CONSTRAINT "EagleExternalAsset_sourceContentSha256_check"
  CHECK ("sourceContentSha256" IS NULL OR "sourceContentSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "EagleImportRun"
  ADD CONSTRAINT "EagleImportRun_declarationHash_check"
  CHECK ("declarationHash" IS NULL OR "declarationHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "EagleImportRunItem"
  ADD CONSTRAINT "EagleImportRunItem_contentSha256_check"
  CHECK ("contentSha256" IS NULL OR "contentSha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "EagleUploadSessionState"
  ADD CONSTRAINT "EagleUploadSessionState_expectedContentSha256_check"
  CHECK ("expectedContentSha256" IS NULL OR "expectedContentSha256" ~ '^[0-9a-f]{64}$');

-- AddForeignKey
ALTER TABLE "EagleImportFolderDefinition" ADD CONSTRAINT "EagleImportFolderDefinition_ownerId_runId_fkey" FOREIGN KEY ("ownerId", "runId") REFERENCES "EagleImportRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportTagDefinition" ADD CONSTRAINT "EagleImportTagDefinition_ownerId_runId_fkey" FOREIGN KEY ("ownerId", "runId") REFERENCES "EagleImportRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportTagGroupDefinition" ADD CONSTRAINT "EagleImportTagGroupDefinition_ownerId_runId_fkey" FOREIGN KEY ("ownerId", "runId") REFERENCES "EagleImportRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetRendition" ADD CONSTRAINT "EagleAssetRendition_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTag" ADD CONSTRAINT "EagleManualTag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTag" ADD CONSTRAINT "EagleManualTag_ownerId_groupId_fkey" FOREIGN KEY ("ownerId", "groupId") REFERENCES "EagleManualTagGroup"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagGroup" ADD CONSTRAINT "EagleManualTagGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagGroupMembership" ADD CONSTRAINT "EagleManualTagGroupMembership_ownerId_tagId_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagGroupMembership" ADD CONSTRAINT "EagleManualTagGroupMembership_ownerId_groupId_fkey" FOREIGN KEY ("ownerId", "groupId") REFERENCES "EagleManualTagGroup"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTag" ADD CONSTRAINT "EagleAssetManualTag_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTag" ADD CONSTRAINT "EagleAssetManualTag_ownerId_tagId_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" ADD CONSTRAINT "EagleAssetManualTagIngestion_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" ADD CONSTRAINT "EagleAssetManualTagIngestion_ownerId_assetId_tagId_fkey" FOREIGN KEY ("ownerId", "assetId", "tagId") REFERENCES "EagleAssetManualTag"("ownerId", "assetId", "tagId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAiAnalysisRun" ADD CONSTRAINT "EagleAiAnalysisRun_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAiTag" ADD CONSTRAINT "EagleAiTag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_aiTagId_fkey" FOREIGN KEY ("ownerId", "aiTagId") REFERENCES "EagleAiTag"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_analysisRunId_fkey" FOREIGN KEY ("ownerId", "analysisRunId") REFERENCES "EagleAiAnalysisRun"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_promotedManualTagId_fkey" FOREIGN KEY ("ownerId", "promotedManualTagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolder" ADD CONSTRAINT "EagleSmartFolder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolder" ADD CONSTRAINT "EagleSmartFolder_ownerId_parentId_fkey" FOREIGN KEY ("ownerId", "parentId") REFERENCES "EagleSmartFolder"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" ADD CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_smartFolderId_fkey" FOREIGN KEY ("ownerId", "smartFolderId") REFERENCES "EagleSmartFolder"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" ADD CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_manualTagId_fkey" FOREIGN KEY ("ownerId", "manualTagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" ADD CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_smartFolderId_fkey" FOREIGN KEY ("ownerId", "smartFolderId") REFERENCES "EagleSmartFolder"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" ADD CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_aiTagId_fkey" FOREIGN KEY ("ownerId", "aiTagId") REFERENCES "EagleAiTag"("ownerId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleMediaJob" ADD CONSTRAINT "EagleMediaJob_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetColorAnalysis" ADD CONSTRAINT "EagleAssetColorAnalysis_ownerId_assetId_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetColorSwatch" ADD CONSTRAINT "EagleAssetColorSwatch_ownerId_analysisId_fkey" FOREIGN KEY ("ownerId", "analysisId") REFERENCES "EagleAssetColorAnalysis"("ownerId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
