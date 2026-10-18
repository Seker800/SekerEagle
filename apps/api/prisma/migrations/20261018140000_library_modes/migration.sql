BEGIN;

-- CreateEnum
CREATE TYPE "LibraryMode" AS ENUM ('MATERIAL', 'PHOTO');

-- DropForeignKey
ALTER TABLE "UploadSession" DROP CONSTRAINT "UploadSession_uploaderId_eagleAssetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleUploadSessionState" DROP CONSTRAINT "EagleUploadSessionState_ownerId_uploadSessionId_fkey";

-- DropForeignKey
ALTER TABLE "EagleUploadSessionState" DROP CONSTRAINT "EagleUploadSessionState_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleUploadSessionState" DROP CONSTRAINT "EagleUploadSessionState_ownerId_replacementAssetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleBrowserCapture" DROP CONSTRAINT "EagleBrowserCapture_ownerId_uploadSessionId_fkey";

-- DropForeignKey
ALTER TABLE "EagleBrowserCapture" DROP CONSTRAINT "EagleBrowserCapture_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetAnnotation" DROP CONSTRAINT "EagleAssetAnnotation_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleExternalAsset" DROP CONSTRAINT "EagleExternalAsset_ownerId_externalLibraryId_fkey";

-- DropForeignKey
ALTER TABLE "EagleExternalAsset" DROP CONSTRAINT "EagleExternalAsset_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportRun" DROP CONSTRAINT "EagleImportRun_ownerId_externalLibraryId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportManifestChunk" DROP CONSTRAINT "EagleImportManifestChunk_ownerId_runId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportRunItem" DROP CONSTRAINT "EagleImportRunItem_ownerId_runId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportRunItem" DROP CONSTRAINT "EagleImportRunItem_ownerId_externalAssetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportRunItem" DROP CONSTRAINT "EagleImportRunItem_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportFolderDefinition" DROP CONSTRAINT "EagleImportFolderDefinition_ownerId_runId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportTagDefinition" DROP CONSTRAINT "EagleImportTagDefinition_ownerId_runId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImportTagGroupDefinition" DROP CONSTRAINT "EagleImportTagGroupDefinition_ownerId_runId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetRendition" DROP CONSTRAINT "EagleAssetRendition_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleImagePyramid" DROP CONSTRAINT "EagleImagePyramid_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleManualTag" DROP CONSTRAINT "EagleManualTag_ownerId_groupId_fkey";

-- DropForeignKey
ALTER TABLE "EagleManualTagGroupMembership" DROP CONSTRAINT "EagleManualTagGroupMembership_ownerId_tagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleManualTagGroupMembership" DROP CONSTRAINT "EagleManualTagGroupMembership_ownerId_groupId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetManualTag" DROP CONSTRAINT "EagleAssetManualTag_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetManualTag" DROP CONSTRAINT "EagleAssetManualTag_ownerId_tagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetEmbedding" DROP CONSTRAINT "EagleAssetEmbedding_asset_fkey";

-- DropForeignKey
ALTER TABLE "EagleManualTagSemanticConfig" DROP CONSTRAINT "EagleManualTagSemanticConfig_tag_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagPrototypeSnapshot" DROP CONSTRAINT "EagleTagPrototypeSnapshot_tag_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagPrototype" DROP CONSTRAINT "EagleTagPrototype_snapshot_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagMemberDistance" DROP CONSTRAINT "EagleTagMemberDistance_asset_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagMemberDistance" DROP CONSTRAINT "EagleTagMemberDistance_tag_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagMemberDistance" DROP CONSTRAINT "EagleTagMemberDistance_snapshot_fkey";

-- DropForeignKey
ALTER TABLE "EagleVectorTagSuggestion" DROP CONSTRAINT "EagleVectorTagSuggestion_asset_fkey";

-- DropForeignKey
ALTER TABLE "EagleVectorTagSuggestion" DROP CONSTRAINT "EagleVectorTagSuggestion_tag_fkey";

-- DropForeignKey
ALTER TABLE "EagleVectorTagSuggestion" DROP CONSTRAINT "EagleVectorTagSuggestion_embedding_fkey";

-- DropForeignKey
ALTER TABLE "EagleVectorTagSuggestion" DROP CONSTRAINT "EagleVectorTagSuggestion_snapshot_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagSemanticBuild" DROP CONSTRAINT "EagleTagSemanticBuild_tag_fkey";

-- DropForeignKey
ALTER TABLE "EagleTagSemanticBuild" DROP CONSTRAINT "EagleTagSemanticBuild_snapshot_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" DROP CONSTRAINT "EagleAssetManualTagIngestion_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" DROP CONSTRAINT "EagleAssetManualTagIngestion_ownerId_assetId_tagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAiAnalysisRun" DROP CONSTRAINT "EagleAiAnalysisRun_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetAiTag" DROP CONSTRAINT "EagleAssetAiTag_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetAiTag" DROP CONSTRAINT "EagleAssetAiTag_ownerId_aiTagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetAiTag" DROP CONSTRAINT "EagleAssetAiTag_ownerId_analysisRunId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetAiTag" DROP CONSTRAINT "EagleAssetAiTag_ownerId_promotedManualTagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleSmartFolder" DROP CONSTRAINT "EagleSmartFolder_ownerId_parentId_fkey";

-- DropForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" DROP CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_smartFolderId_fkey";

-- DropForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" DROP CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_manualTagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" DROP CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_smartFolderId_fkey";

-- DropForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" DROP CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_aiTagId_fkey";

-- DropForeignKey
ALTER TABLE "EagleMediaJob" DROP CONSTRAINT "EagleMediaJob_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetColorAnalysis" DROP CONSTRAINT "EagleAssetColorAnalysis_ownerId_assetId_fkey";

-- DropForeignKey
ALTER TABLE "EagleAssetColorSwatch" DROP CONSTRAINT "EagleAssetColorSwatch_ownerId_analysisId_fkey";

-- DropIndex
DROP INDEX "UploadSession_uploaderId_createdAt_idx";

-- DropIndex
DROP INDEX "EagleUploadSessionState_ownerId_createdAt_idx";

-- DropIndex
DROP INDEX "EagleUploadSessionState_ownerId_replacementAssetId_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_deletedAt_libraryAddedAt_id_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_isPrivate_deletedAt_libraryAddedAt_id_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_deletedAt_rating_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_deletedAt_aspectRatio_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_normalizedDisplayName_idx";

-- DropIndex
DROP INDEX "EagleAsset_ownerId_sha256_idx";

-- DropIndex
DROP INDEX "EagleBrowserCapture_ownerId_createdAt_idx";

-- DropIndex
DROP INDEX "EagleBrowserCapture_ownerId_assetId_capturedAt_idx";

-- DropIndex
DROP INDEX "EagleAssetAnnotation_ownerId_updatedAt_idx";

-- DropIndex
DROP INDEX "EagleExternalLibrary_ownerId_updatedAt_idx";

-- DropIndex
DROP INDEX "EagleExternalLibrary_ownerId_provider_externalLibraryId_key";

-- DropIndex
DROP INDEX "EagleExternalAsset_ownerId_externalItemId_idx";

-- DropIndex
DROP INDEX "EagleImportRun_ownerId_status_updatedAt_idx";

-- DropIndex
DROP INDEX "EagleImportRun_ownerId_idempotencyKey_key";

-- DropIndex
DROP INDEX "EagleImportManifestChunk_ownerId_runId_createdAt_idx";

-- DropIndex
DROP INDEX "EagleImportRunItem_ownerId_runId_status_id_idx";

-- DropIndex
DROP INDEX "EagleImportFolderDefinition_ownerId_runId_idx";

-- DropIndex
DROP INDEX "EagleImportTagDefinition_ownerId_runId_idx";

-- DropIndex
DROP INDEX "EagleImportTagGroupDefinition_ownerId_runId_idx";

-- DropIndex
DROP INDEX "EagleAssetRendition_ownerId_assetId_idx";

-- DropIndex
DROP INDEX "EagleImagePyramid_ownerId_assetId_status_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_name_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_groupId_name_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_isStarred_name_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_marksAssetsPrivate_id_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_lastUsedAt_id_idx";

-- DropIndex
DROP INDEX "EagleManualTag_ownerId_normalizedName_key";

-- DropIndex
DROP INDEX "EagleManualTagGroup_ownerId_name_idx";

-- DropIndex
DROP INDEX "EagleManualTagGroup_ownerId_normalizedName_key";

-- DropIndex
DROP INDEX "EagleManualTagGroupMembership_ownerId_groupId_tagId_idx";

-- DropIndex
DROP INDEX "EagleAssetManualTag_ownerId_tagId_assetId_idx";

-- DropIndex
DROP INDEX "EagleAssetEmbedding_status_idx";

-- DropIndex
DROP INDEX "EagleManualTagSemanticConfig_enabled_idx";

-- DropIndex
-- Historical schema declared this index, but baseline migrations never created it: EagleTagPrototypeSnapshot_ownerId_tagId_isCurrent_status_idx

-- DropIndex
DROP INDEX "EagleTagMemberDistance_sort_idx";

-- DropIndex
DROP INDEX "EagleVectorTagSuggestion_group_idx";

-- DropIndex
-- Historical schema declared this index, but baseline migrations never created it: EagleVectorTagSuggestion_ownerId_assetId_status_idx

-- DropIndex
DROP INDEX "EagleTagSemanticBuild_tag_idx";

-- DropIndex
DROP INDEX "EagleAssetManualTagIngestion_ownerId_assetId_sourceKey_idx";

-- DropIndex
DROP INDEX "EagleAiAnalysisRun_ownerId_assetId_assetRevision_createdAt_idx";

-- DropIndex
DROP INDEX "EagleAiAnalysisRun_completion_lookup_idx";

-- DropIndex
DROP INDEX "EagleAiTag_ownerId_name_idx";

-- DropIndex
DROP INDEX "EagleAiTag_ownerId_embeddingSpaceId_idx";

-- DropIndex
DROP INDEX "EagleAiTag_ownerId_normalizedName_key";

-- DropIndex
DROP INDEX "EagleAssetAiTag_ownerId_aiTagId_assetId_idx";

-- DropIndex
DROP INDEX "EagleAssetAiTag_ownerId_analysisRunId_idx";

-- DropIndex
DROP INDEX "EagleSmartFolder_ownerId_parentId_position_id_idx";

-- DropIndex
DROP INDEX "EagleSmartFolder_ownerId_normalizedName_key";

-- DropIndex
DROP INDEX "EagleSmartFolderManualTagDependency_ownerId_manualTagId_sma_idx";

-- DropIndex
DROP INDEX "EagleSmartFolderAiTagDependency_ownerId_aiTagId_smartFolder_idx";

-- DropIndex
DROP INDEX "EagleMediaJob_ownerId_assetId_idx";

-- DropIndex
DROP INDEX "EagleMediaJob_ownerId_status_kind_processorVersion_idx";

-- DropIndex
DROP INDEX "EagleAssetColorAnalysis_ownerId_assetId_assetRevision_idx";

-- DropIndex
DROP INDEX "EagleAssetColorAnalysis_ownerId_processorVersion_isCurrent__idx";

-- DropIndex
DROP INDEX "EagleAssetColorSwatch_ownerId_analysisId_idx";

-- DropIndex
DROP INDEX "EagleAssetColorSwatch_ownerId_labL_idx";

-- DropIndex
DROP INDEX "EagleAssetColorSwatch_ownerId_labL_labA_labB_idx";

-- AlterTable
ALTER TABLE "UploadSession" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleUploadSessionState" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAsset" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleBrowserCapture" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetAnnotation" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleExternalLibrary" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleExternalAsset" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportRun" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportManifestChunk" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportRunItem" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportFolderDefinition" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportTagDefinition" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImportTagGroupDefinition" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetRendition" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleImagePyramid" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleManualTag" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleManualTagGroup" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleManualTagGroupMembership" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetManualTag" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetEmbedding" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleManualTagSemanticConfig" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleTagPrototypeSnapshot" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleTagPrototype" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleTagMemberDistance" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleVectorTagSuggestion" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleTagSemanticBuild" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetManualTagIngestion" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAiAnalysisRun" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAiTag" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetAiTag" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleSmartFolder" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleSmartFolderManualTagDependency" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleSmartFolderAiTagDependency" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleMediaJob" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetColorAnalysis" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleAssetColorSwatch" ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL';

-- AlterTable
ALTER TABLE "EagleProcessingSetting" DROP CONSTRAINT "EagleProcessingSetting_pkey",
ADD COLUMN     "libraryMode" "LibraryMode" NOT NULL DEFAULT 'MATERIAL',
ADD CONSTRAINT "EagleProcessingSetting_pkey" PRIMARY KEY ("ownerId", "libraryMode");

-- CreateIndex
CREATE INDEX "UploadSession_uploaderId_libraryMode_createdAt_idx" ON "UploadSession"("uploaderId", "libraryMode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_uploaderId_libraryMode_id_key" ON "UploadSession"("uploaderId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleUploadSessionState_ownerId_libraryMode_createdAt_idx" ON "EagleUploadSessionState"("ownerId", "libraryMode", "createdAt");

-- CreateIndex
CREATE INDEX "EagleUploadSessionState_ownerId_libraryMode_replacementAsse_idx" ON "EagleUploadSessionState"("ownerId", "libraryMode", "replacementAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleUploadSessionState_ownerId_libraryMode_uploadSessionId_key" ON "EagleUploadSessionState"("ownerId", "libraryMode", "uploadSessionId");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_deletedAt_libraryAddedAt_id_idx" ON "EagleAsset"("ownerId", "libraryMode", "deletedAt", "libraryAddedAt", "id");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_isPrivate_deletedAt_libraryA_idx" ON "EagleAsset"("ownerId", "libraryMode", "isPrivate", "deletedAt", "libraryAddedAt", "id");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_deletedAt_rating_idx" ON "EagleAsset"("ownerId", "libraryMode", "deletedAt", "rating");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_deletedAt_aspectRatio_idx" ON "EagleAsset"("ownerId", "libraryMode", "deletedAt", "aspectRatio");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_normalizedDisplayName_idx" ON "EagleAsset"("ownerId", "libraryMode", "normalizedDisplayName");

-- CreateIndex
CREATE INDEX "EagleAsset_ownerId_libraryMode_sha256_idx" ON "EagleAsset"("ownerId", "libraryMode", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAsset_ownerId_libraryMode_id_key" ON "EagleAsset"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleBrowserCapture_ownerId_libraryMode_createdAt_idx" ON "EagleBrowserCapture"("ownerId", "libraryMode", "createdAt");

-- CreateIndex
CREATE INDEX "EagleBrowserCapture_ownerId_libraryMode_assetId_capturedAt_idx" ON "EagleBrowserCapture"("ownerId", "libraryMode", "assetId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_libraryMode_id_key" ON "EagleBrowserCapture"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_libraryMode_clientCaptureId_key" ON "EagleBrowserCapture"("ownerId", "libraryMode", "clientCaptureId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleBrowserCapture_ownerId_libraryMode_uploadSessionId_key" ON "EagleBrowserCapture"("ownerId", "libraryMode", "uploadSessionId");

-- CreateIndex
CREATE INDEX "EagleAssetAnnotation_ownerId_libraryMode_updatedAt_idx" ON "EagleAssetAnnotation"("ownerId", "libraryMode", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetAnnotation_ownerId_libraryMode_assetId_key" ON "EagleAssetAnnotation"("ownerId", "libraryMode", "assetId");

-- CreateIndex
CREATE INDEX "EagleExternalLibrary_ownerId_libraryMode_updatedAt_idx" ON "EagleExternalLibrary"("ownerId", "libraryMode", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalLibrary_ownerId_libraryMode_provider_externalL_key" ON "EagleExternalLibrary"("ownerId", "libraryMode", "provider", "externalLibraryId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalLibrary_ownerId_libraryMode_id_key" ON "EagleExternalLibrary"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleExternalAsset_ownerId_libraryMode_externalItemId_idx" ON "EagleExternalAsset"("ownerId", "libraryMode", "externalItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_libraryMode_id_key" ON "EagleExternalAsset"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_libraryMode_externalLibraryId_ex_key" ON "EagleExternalAsset"("ownerId", "libraryMode", "externalLibraryId", "externalItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleExternalAsset_ownerId_libraryMode_assetId_key" ON "EagleExternalAsset"("ownerId", "libraryMode", "assetId");

-- CreateIndex
CREATE INDEX "EagleImportRun_ownerId_libraryMode_status_updatedAt_idx" ON "EagleImportRun"("ownerId", "libraryMode", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRun_ownerId_libraryMode_idempotencyKey_key" ON "EagleImportRun"("ownerId", "libraryMode", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRun_ownerId_libraryMode_id_key" ON "EagleImportRun"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleImportManifestChunk_ownerId_libraryMode_runId_createdA_idx" ON "EagleImportManifestChunk"("ownerId", "libraryMode", "runId", "createdAt");

-- CreateIndex
CREATE INDEX "EagleImportRunItem_ownerId_libraryMode_runId_status_id_idx" ON "EagleImportRunItem"("ownerId", "libraryMode", "runId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleImportRunItem_ownerId_libraryMode_id_key" ON "EagleImportRunItem"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleImportFolderDefinition_ownerId_libraryMode_runId_idx" ON "EagleImportFolderDefinition"("ownerId", "libraryMode", "runId");

-- CreateIndex
CREATE INDEX "EagleImportTagDefinition_ownerId_libraryMode_runId_idx" ON "EagleImportTagDefinition"("ownerId", "libraryMode", "runId");

-- CreateIndex
CREATE INDEX "EagleImportTagGroupDefinition_ownerId_libraryMode_runId_idx" ON "EagleImportTagGroupDefinition"("ownerId", "libraryMode", "runId");

-- CreateIndex
CREATE INDEX "EagleAssetRendition_ownerId_libraryMode_assetId_idx" ON "EagleAssetRendition"("ownerId", "libraryMode", "assetId");

-- CreateIndex
CREATE INDEX "EagleImagePyramid_ownerId_libraryMode_assetId_status_idx" ON "EagleImagePyramid"("ownerId", "libraryMode", "assetId", "status");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_libraryMode_name_idx" ON "EagleManualTag"("ownerId", "libraryMode", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_libraryMode_groupId_name_idx" ON "EagleManualTag"("ownerId", "libraryMode", "groupId", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_libraryMode_isStarred_name_idx" ON "EagleManualTag"("ownerId", "libraryMode", "isStarred", "name");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_libraryMode_marksAssetsPrivate_id_idx" ON "EagleManualTag"("ownerId", "libraryMode", "marksAssetsPrivate", "id");

-- CreateIndex
CREATE INDEX "EagleManualTag_ownerId_libraryMode_lastUsedAt_id_idx" ON "EagleManualTag"("ownerId", "libraryMode", "lastUsedAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTag_ownerId_libraryMode_normalizedName_key" ON "EagleManualTag"("ownerId", "libraryMode", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTag_ownerId_libraryMode_id_key" ON "EagleManualTag"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleManualTagGroup_ownerId_libraryMode_name_idx" ON "EagleManualTagGroup"("ownerId", "libraryMode", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagGroup_ownerId_libraryMode_normalizedName_key" ON "EagleManualTagGroup"("ownerId", "libraryMode", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagGroup_ownerId_libraryMode_id_key" ON "EagleManualTagGroup"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleManualTagGroupMembership_ownerId_libraryMode_groupId_t_idx" ON "EagleManualTagGroupMembership"("ownerId", "libraryMode", "groupId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagGroupMembership_ownerId_libraryMode_tagId_gro_key" ON "EagleManualTagGroupMembership"("ownerId", "libraryMode", "tagId", "groupId");

-- CreateIndex
CREATE INDEX "EagleAssetManualTag_ownerId_libraryMode_tagId_assetId_idx" ON "EagleAssetManualTag"("ownerId", "libraryMode", "tagId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetManualTag_ownerId_libraryMode_assetId_tagId_key" ON "EagleAssetManualTag"("ownerId", "libraryMode", "assetId", "tagId");

-- CreateIndex
CREATE INDEX "EagleAssetEmbedding_ownerId_libraryMode_spaceId_isCurrent_s_idx" ON "EagleAssetEmbedding"("ownerId", "libraryMode", "spaceId", "isCurrent", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetEmbedding_ownerId_libraryMode_id_key" ON "EagleAssetEmbedding"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleManualTagSemanticConfig_ownerId_libraryMode_recommenda_idx" ON "EagleManualTagSemanticConfig"("ownerId", "libraryMode", "recommendationEnabled", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleManualTagSemanticConfig_ownerId_libraryMode_tagId_key" ON "EagleManualTagSemanticConfig"("ownerId", "libraryMode", "tagId");

-- CreateIndex
CREATE INDEX "EagleTagPrototypeSnapshot_ownerId_libraryMode_tagId_isCurre_idx" ON "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "tagId", "isCurrent", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagPrototypeSnapshot_ownerId_libraryMode_id_key" ON "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagPrototypeSnapshot_ownerId_libraryMode_tagId_version_key" ON "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "tagId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagPrototype_ownerId_libraryMode_snapshotId_rank_key" ON "EagleTagPrototype"("ownerId", "libraryMode", "snapshotId", "rank");

-- CreateIndex
CREATE INDEX "EagleTagMemberDistance_ownerId_libraryMode_tagId_snapshotId_idx" ON "EagleTagMemberDistance"("ownerId", "libraryMode", "tagId", "snapshotId", "distance", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagMemberDistance_ownerId_libraryMode_tagId_assetId_sn_key" ON "EagleTagMemberDistance"("ownerId", "libraryMode", "tagId", "assetId", "snapshotId");

-- CreateIndex
CREATE INDEX "EagleVectorTagSuggestion_ownerId_libraryMode_suggestedTagId_idx" ON "EagleVectorTagSuggestion"("ownerId", "libraryMode", "suggestedTagId", "status", "score", "assetId");

-- CreateIndex
CREATE INDEX "EagleVectorTagSuggestion_ownerId_libraryMode_assetId_status_idx" ON "EagleVectorTagSuggestion"("ownerId", "libraryMode", "assetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleVectorTagSuggestion_ownerId_libraryMode_id_key" ON "EagleVectorTagSuggestion"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleTagSemanticBuild_ownerId_libraryMode_tagId_status_idx" ON "EagleTagSemanticBuild"("ownerId", "libraryMode", "tagId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagSemanticBuild_ownerId_libraryMode_id_key" ON "EagleTagSemanticBuild"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleTagSemanticBuild_ownerId_libraryMode_candidateSnapshot_key" ON "EagleTagSemanticBuild"("ownerId", "libraryMode", "candidateSnapshotId");

-- CreateIndex
CREATE INDEX "EagleAssetManualTagIngestion_ownerId_libraryMode_assetId_so_idx" ON "EagleAssetManualTagIngestion"("ownerId", "libraryMode", "assetId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetManualTagIngestion_ownerId_libraryMode_assetId_ta_key" ON "EagleAssetManualTagIngestion"("ownerId", "libraryMode", "assetId", "tagId", "sourceKey");

-- CreateIndex
CREATE INDEX "EagleAiAnalysisRun_ownerId_libraryMode_assetId_assetRevisio_idx" ON "EagleAiAnalysisRun"("ownerId", "libraryMode", "assetId", "assetRevision", "createdAt");

-- CreateIndex
CREATE INDEX "EagleAiAnalysisRun_completion_lookup_idx" ON "EagleAiAnalysisRun"("ownerId", "libraryMode", "assetId", "assetRevision", "processorVersion", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiAnalysisRun_ownerId_libraryMode_id_key" ON "EagleAiAnalysisRun"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleAiTag_ownerId_libraryMode_name_idx" ON "EagleAiTag"("ownerId", "libraryMode", "name");

-- CreateIndex
CREATE INDEX "EagleAiTag_ownerId_libraryMode_embeddingSpaceId_idx" ON "EagleAiTag"("ownerId", "libraryMode", "embeddingSpaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiTag_ownerId_libraryMode_normalizedName_key" ON "EagleAiTag"("ownerId", "libraryMode", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAiTag_ownerId_libraryMode_id_key" ON "EagleAiTag"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleAssetAiTag_ownerId_libraryMode_aiTagId_assetId_idx" ON "EagleAssetAiTag"("ownerId", "libraryMode", "aiTagId", "assetId");

-- CreateIndex
CREATE INDEX "EagleAssetAiTag_ownerId_libraryMode_analysisRunId_idx" ON "EagleAssetAiTag"("ownerId", "libraryMode", "analysisRunId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetAiTag_ownerId_libraryMode_assetId_aiTagId_analysi_key" ON "EagleAssetAiTag"("ownerId", "libraryMode", "assetId", "aiTagId", "analysisRunId");

-- CreateIndex
CREATE INDEX "EagleSmartFolder_ownerId_libraryMode_parentId_position_id_idx" ON "EagleSmartFolder"("ownerId", "libraryMode", "parentId", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolder_ownerId_libraryMode_normalizedName_key" ON "EagleSmartFolder"("ownerId", "libraryMode", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolder_ownerId_libraryMode_id_key" ON "EagleSmartFolder"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleSmartFolderManualTagDependency_ownerId_libraryMode_man_idx" ON "EagleSmartFolderManualTagDependency"("ownerId", "libraryMode", "manualTagId", "smartFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolderManualTagDependency_ownerId_libraryMode_sma_key" ON "EagleSmartFolderManualTagDependency"("ownerId", "libraryMode", "smartFolderId", "manualTagId");

-- CreateIndex
CREATE INDEX "EagleSmartFolderAiTagDependency_ownerId_libraryMode_aiTagId_idx" ON "EagleSmartFolderAiTagDependency"("ownerId", "libraryMode", "aiTagId", "smartFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolderAiTagDependency_ownerId_libraryMode_smartFo_key" ON "EagleSmartFolderAiTagDependency"("ownerId", "libraryMode", "smartFolderId", "aiTagId");

-- CreateIndex
CREATE INDEX "EagleMediaJob_ownerId_libraryMode_assetId_idx" ON "EagleMediaJob"("ownerId", "libraryMode", "assetId");

-- CreateIndex
CREATE INDEX "EagleMediaJob_ownerId_libraryMode_status_kind_processorVers_idx" ON "EagleMediaJob"("ownerId", "libraryMode", "status", "kind", "processorVersion");

-- CreateIndex
CREATE INDEX "EagleAssetColorAnalysis_ownerId_libraryMode_assetId_assetRe_idx" ON "EagleAssetColorAnalysis"("ownerId", "libraryMode", "assetId", "assetRevision");

-- CreateIndex
CREATE INDEX "EagleAssetColorAnalysis_ownerId_libraryMode_processorVersio_idx" ON "EagleAssetColorAnalysis"("ownerId", "libraryMode", "processorVersion", "isCurrent", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EagleAssetColorAnalysis_ownerId_libraryMode_id_key" ON "EagleAssetColorAnalysis"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_ownerId_libraryMode_analysisId_idx" ON "EagleAssetColorSwatch"("ownerId", "libraryMode", "analysisId");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_ownerId_libraryMode_labL_idx" ON "EagleAssetColorSwatch"("ownerId", "libraryMode", "labL");

-- CreateIndex
CREATE INDEX "EagleAssetColorSwatch_ownerId_libraryMode_labL_labA_labB_idx" ON "EagleAssetColorSwatch"("ownerId", "libraryMode", "labL", "labA", "labB");

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_uploaderId_libraryMode_eagleAssetId_fkey" FOREIGN KEY ("uploaderId", "libraryMode", "eagleAssetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_libraryMode_uploadSessionI_fkey" FOREIGN KEY ("ownerId", "libraryMode", "uploadSessionId") REFERENCES "UploadSession"("uploaderId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleUploadSessionState" ADD CONSTRAINT "EagleUploadSessionState_ownerId_libraryMode_replacementAss_fkey" FOREIGN KEY ("ownerId", "libraryMode", "replacementAssetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleBrowserCapture" ADD CONSTRAINT "EagleBrowserCapture_ownerId_libraryMode_uploadSessionId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "uploadSessionId") REFERENCES "UploadSession"("uploaderId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleBrowserCapture" ADD CONSTRAINT "EagleBrowserCapture_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAnnotation" ADD CONSTRAINT "EagleAssetAnnotation_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalAsset" ADD CONSTRAINT "EagleExternalAsset_ownerId_libraryMode_externalLibraryId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "externalLibraryId") REFERENCES "EagleExternalLibrary"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleExternalAsset" ADD CONSTRAINT "EagleExternalAsset_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE SET NULL ("assetId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRun" ADD CONSTRAINT "EagleImportRun_ownerId_libraryMode_externalLibraryId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "externalLibraryId") REFERENCES "EagleExternalLibrary"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportManifestChunk" ADD CONSTRAINT "EagleImportManifestChunk_ownerId_libraryMode_runId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "runId") REFERENCES "EagleImportRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_libraryMode_runId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "runId") REFERENCES "EagleImportRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_libraryMode_externalAssetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "externalAssetId") REFERENCES "EagleExternalAsset"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportRunItem" ADD CONSTRAINT "EagleImportRunItem_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE SET NULL ("assetId") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportFolderDefinition" ADD CONSTRAINT "EagleImportFolderDefinition_ownerId_libraryMode_runId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "runId") REFERENCES "EagleImportRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportTagDefinition" ADD CONSTRAINT "EagleImportTagDefinition_ownerId_libraryMode_runId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "runId") REFERENCES "EagleImportRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImportTagGroupDefinition" ADD CONSTRAINT "EagleImportTagGroupDefinition_ownerId_libraryMode_runId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "runId") REFERENCES "EagleImportRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetRendition" ADD CONSTRAINT "EagleAssetRendition_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleImagePyramid" ADD CONSTRAINT "EagleImagePyramid_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTag" ADD CONSTRAINT "EagleManualTag_ownerId_libraryMode_groupId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "groupId") REFERENCES "EagleManualTagGroup"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagGroupMembership" ADD CONSTRAINT "EagleManualTagGroupMembership_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagGroupMembership" ADD CONSTRAINT "EagleManualTagGroupMembership_ownerId_libraryMode_groupId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "groupId") REFERENCES "EagleManualTagGroup"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTag" ADD CONSTRAINT "EagleAssetManualTag_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTag" ADD CONSTRAINT "EagleAssetManualTag_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetEmbedding" ADD CONSTRAINT "EagleAssetEmbedding_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleManualTagSemanticConfig" ADD CONSTRAINT "EagleManualTagSemanticConfig_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagPrototypeSnapshot" ADD CONSTRAINT "EagleTagPrototypeSnapshot_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagPrototype" ADD CONSTRAINT "EagleTagPrototype_ownerId_libraryMode_snapshotId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagMemberDistance" ADD CONSTRAINT "EagleTagMemberDistance_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagMemberDistance" ADD CONSTRAINT "EagleTagMemberDistance_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagMemberDistance" ADD CONSTRAINT "EagleTagMemberDistance_ownerId_libraryMode_snapshotId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleVectorTagSuggestion" ADD CONSTRAINT "EagleVectorTagSuggestion_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleVectorTagSuggestion" ADD CONSTRAINT "EagleVectorTagSuggestion_ownerId_libraryMode_suggestedTagI_fkey" FOREIGN KEY ("ownerId", "libraryMode", "suggestedTagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleVectorTagSuggestion" ADD CONSTRAINT "EagleVectorTagSuggestion_ownerId_libraryMode_embeddingId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "embeddingId") REFERENCES "EagleAssetEmbedding"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleVectorTagSuggestion" ADD CONSTRAINT "EagleVectorTagSuggestion_ownerId_libraryMode_snapshotId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagSemanticBuild" ADD CONSTRAINT "EagleTagSemanticBuild_ownerId_libraryMode_tagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "tagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleTagSemanticBuild" ADD CONSTRAINT "EagleTagSemanticBuild_ownerId_libraryMode_candidateSnapsho_fkey" FOREIGN KEY ("ownerId", "libraryMode", "candidateSnapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" ADD CONSTRAINT "EagleAssetManualTagIngestion_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetManualTagIngestion" ADD CONSTRAINT "EagleAssetManualTagIngestion_ownerId_libraryMode_assetId_t_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId", "tagId") REFERENCES "EagleAssetManualTag"("ownerId", "libraryMode", "assetId", "tagId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAiAnalysisRun" ADD CONSTRAINT "EagleAiAnalysisRun_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_libraryMode_aiTagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "aiTagId") REFERENCES "EagleAiTag"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_libraryMode_analysisRunId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "analysisRunId") REFERENCES "EagleAiAnalysisRun"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetAiTag" ADD CONSTRAINT "EagleAssetAiTag_ownerId_libraryMode_promotedManualTagId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "promotedManualTagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolder" ADD CONSTRAINT "EagleSmartFolder_ownerId_libraryMode_parentId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "parentId") REFERENCES "EagleSmartFolder"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" ADD CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_libraryMode_sm_fkey" FOREIGN KEY ("ownerId", "libraryMode", "smartFolderId") REFERENCES "EagleSmartFolder"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderManualTagDependency" ADD CONSTRAINT "EagleSmartFolderManualTagDependency_ownerId_libraryMode_ma_fkey" FOREIGN KEY ("ownerId", "libraryMode", "manualTagId") REFERENCES "EagleManualTag"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" ADD CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_libraryMode_smartF_fkey" FOREIGN KEY ("ownerId", "libraryMode", "smartFolderId") REFERENCES "EagleSmartFolder"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderAiTagDependency" ADD CONSTRAINT "EagleSmartFolderAiTagDependency_ownerId_libraryMode_aiTagI_fkey" FOREIGN KEY ("ownerId", "libraryMode", "aiTagId") REFERENCES "EagleAiTag"("ownerId", "libraryMode", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleMediaJob" ADD CONSTRAINT "EagleMediaJob_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetColorAnalysis" ADD CONSTRAINT "EagleAssetColorAnalysis_ownerId_libraryMode_assetId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "assetId") REFERENCES "EagleAsset"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleAssetColorSwatch" ADD CONSTRAINT "EagleAssetColorSwatch_ownerId_libraryMode_analysisId_fkey" FOREIGN KEY ("ownerId", "libraryMode", "analysisId") REFERENCES "EagleAssetColorAnalysis"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Library membership is an immutable business boundary, including raw SQL updates.
CREATE FUNCTION enforce_library_mode_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."libraryMode" IS DISTINCT FROM OLD."libraryMode" THEN
    RAISE EXCEPTION 'library mode is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAiAnalysisRun" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAiTag" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAsset" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetAiTag" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetAnnotation" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetColorAnalysis" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetColorSwatch" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetEmbedding" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetManualTag" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetManualTagIngestion" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleMediaJob" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetRendition" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleBrowserCapture" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleExternalAsset" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleExternalLibrary" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImagePyramid" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportFolderDefinition" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportManifestChunk" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportRun" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportRunItem" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportTagDefinition" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleImportTagGroupDefinition" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleManualTag" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleManualTagGroup" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleManualTagGroupMembership" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleManualTagSemanticConfig" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleProcessingSetting" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleSmartFolder" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleSmartFolderAiTagDependency" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleSmartFolderManualTagDependency" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleTagMemberDistance" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleTagPrototype" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleTagPrototypeSnapshot" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleTagSemanticBuild" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleUploadSessionState" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleVectorTagSuggestion" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "UploadSession" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

-- Dependencies cannot point into the other library, even for the same owner.
CREATE UNIQUE INDEX "EagleMediaJob_ownerId_libraryMode_id_key" ON "EagleMediaJob"("ownerId", "libraryMode", "id");
ALTER TABLE "EagleMediaJob" DROP CONSTRAINT "EagleMediaJob_dependsOnJobId_fkey";
ALTER TABLE "EagleMediaJob" ADD CONSTRAINT "EagleMediaJob_library_dependency_fkey"
  FOREIGN KEY ("ownerId", "libraryMode", "dependsOnJobId")
  REFERENCES "EagleMediaJob"("ownerId", "libraryMode", "id")
  ON DELETE SET NULL ("dependsOnJobId") ON UPDATE CASCADE;

COMMIT;
