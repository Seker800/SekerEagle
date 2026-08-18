CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE "EagleMediaJobKind" ADD VALUE IF NOT EXISTS 'GENERATE_EMBEDDING';

CREATE TYPE "EagleEmbeddingStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'SUPERSEDED');
CREATE TYPE "EagleTagPrototypeStatus" AS ENUM ('BUILDING', 'ACTIVE', 'FAILED', 'SUPERSEDED');
CREATE TYPE "EagleVectorSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');
CREATE TYPE "EagleTagSemanticBuildStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

ALTER TABLE "EagleAssetManualTag"
  ADD COLUMN "assignmentProvenance" TEXT NOT NULL DEFAULT 'USER_ASSIGNED',
  ADD COLUMN "acceptedSuggestionId" TEXT;

UPDATE "EagleAssetManualTag"
SET "assignmentProvenance" = 'EAGLE_IMPORTED'
WHERE "assignedByUser" = false;

CREATE TABLE "EagleEmbeddingSpace" (
  "id" TEXT PRIMARY KEY,
  "model" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "dimensions" INTEGER NOT NULL DEFAULT 1024 CHECK ("dimensions" = 1024),
  "instructionVersion" TEXT NOT NULL,
  "preprocessingVersion" TEXT NOT NULL,
  "normalized" BOOLEAN NOT NULL DEFAULT true,
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EagleEmbeddingSpace_contract_key" UNIQUE ("model", "revision", "dimensions", "instructionVersion", "preprocessingVersion")
);

CREATE UNIQUE INDEX "EagleEmbeddingSpace_one_current_idx"
  ON "EagleEmbeddingSpace" ("isCurrent") WHERE "isCurrent" = true;

CREATE TABLE "EagleAssetEmbedding" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetRevision" INTEGER NOT NULL,
  "spaceId" TEXT NOT NULL,
  "status" "EagleEmbeddingStatus" NOT NULL DEFAULT 'PENDING',
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "embedding" vector(1024),
  "l2Norm" DOUBLE PRECISION,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleAssetEmbedding_asset_key" UNIQUE ("assetId", "assetRevision", "spaceId"),
  CONSTRAINT "EagleAssetEmbedding_owner_id_key" UNIQUE ("ownerId", "id"),
  CONSTRAINT "EagleAssetEmbedding_asset_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleAssetEmbedding_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "EagleEmbeddingSpace"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "EagleAssetEmbedding_current_idx"
  ON "EagleAssetEmbedding" ("ownerId", "assetId") WHERE "isCurrent" = true;
CREATE INDEX "EagleAssetEmbedding_status_idx" ON "EagleAssetEmbedding" ("ownerId", "spaceId", "isCurrent", "status");
CREATE INDEX "EagleAssetEmbedding_hnsw_idx" ON "EagleAssetEmbedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "status" = 'READY' AND "isCurrent" = true;

CREATE TABLE "EagleManualTagSemanticConfig" (
  "ownerId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "recommendationEnabled" BOOLEAN NOT NULL DEFAULT false,
  "currentSnapshotId" TEXT,
  "lastGeneratedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("ownerId", "tagId"),
  CONSTRAINT "EagleManualTagSemanticConfig_tag_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE
);
CREATE INDEX "EagleManualTagSemanticConfig_enabled_idx" ON "EagleManualTagSemanticConfig" ("ownerId", "recommendationEnabled", "tagId");

CREATE TABLE "EagleTagPrototypeSnapshot" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "generationId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "status" "EagleTagPrototypeStatus" NOT NULL DEFAULT 'BUILDING',
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "sourceAssetCount" INTEGER NOT NULL,
  "sourceSetDigest" TEXT NOT NULL,
  "algorithm" TEXT NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "algorithmParams" JSONB NOT NULL,
  "addedMemberCount" INTEGER NOT NULL DEFAULT 0,
  "removedMemberCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleTagPrototypeSnapshot_owner_id_key" UNIQUE ("ownerId", "id"),
  CONSTRAINT "EagleTagPrototypeSnapshot_version_key" UNIQUE ("ownerId", "tagId", "version"),
  CONSTRAINT "EagleTagPrototypeSnapshot_tag_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleTagPrototypeSnapshot_space_fkey" FOREIGN KEY ("spaceId") REFERENCES "EagleEmbeddingSpace"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "EagleTagPrototypeSnapshot_current_idx" ON "EagleTagPrototypeSnapshot" ("ownerId", "tagId") WHERE "isCurrent" = true;
CREATE INDEX "EagleTagPrototypeSnapshot_generation_idx" ON "EagleTagPrototypeSnapshot" ("generationId");

CREATE TABLE "EagleTagPrototype" (
  "ownerId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "memberCount" INTEGER NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "meanDistance" DOUBLE PRECISION NOT NULL,
  "p95Distance" DOUBLE PRECISION NOT NULL,
  "representativeAssetIds" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "snapshotId", "rank"),
  CONSTRAINT "EagleTagPrototype_snapshot_fkey" FOREIGN KEY ("ownerId", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "id") ON DELETE CASCADE
);
CREATE INDEX "EagleTagPrototype_hnsw_idx" ON "EagleTagPrototype" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE "EagleTagMemberDistance" (
  "ownerId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "distance" DOUBLE PRECISION NOT NULL,
  "prototypeRank" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("ownerId", "tagId", "assetId", "snapshotId"),
  CONSTRAINT "EagleTagMemberDistance_asset_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleTagMemberDistance_tag_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleTagMemberDistance_snapshot_fkey" FOREIGN KEY ("ownerId", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "id") ON DELETE CASCADE
);
CREATE INDEX "EagleTagMemberDistance_sort_idx" ON "EagleTagMemberDistance" ("ownerId", "tagId", "snapshotId", "distance" DESC, "assetId" DESC);

CREATE TABLE "EagleVectorTagSuggestion" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "suggestedTagId" TEXT NOT NULL,
  "embeddingId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "distance" DOUBLE PRECISION NOT NULL,
  "prototypeRank" INTEGER NOT NULL,
  "status" "EagleVectorSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "invalidatedAt" TIMESTAMP(3),
  "invalidReason" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleVectorTagSuggestion_owner_id_key" UNIQUE ("ownerId", "id"),
  CONSTRAINT "EagleVectorTagSuggestion_asset_fkey" FOREIGN KEY ("ownerId", "assetId") REFERENCES "EagleAsset"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleVectorTagSuggestion_tag_fkey" FOREIGN KEY ("ownerId", "suggestedTagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleVectorTagSuggestion_embedding_fkey" FOREIGN KEY ("ownerId", "embeddingId") REFERENCES "EagleAssetEmbedding"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleVectorTagSuggestion_snapshot_fkey" FOREIGN KEY ("ownerId", "snapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "EagleVectorTagSuggestion_effective_pending_idx" ON "EagleVectorTagSuggestion" ("ownerId", "assetId") WHERE "isActive" = true AND "status" = 'PENDING' AND "invalidatedAt" IS NULL;
CREATE INDEX "EagleVectorTagSuggestion_group_idx" ON "EagleVectorTagSuggestion" ("ownerId", "suggestedTagId", "status", "score" DESC, "assetId");
CREATE INDEX "EagleVectorTagSuggestion_generation_idx" ON "EagleVectorTagSuggestion" ("generationId");

CREATE TABLE "EagleTagSemanticBuild" (
  "id" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "candidateSnapshotId" TEXT UNIQUE,
  "operation" TEXT NOT NULL DEFAULT 'REBUILD_CENTER',
  "status" "EagleTagSemanticBuildStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EagleTagSemanticBuild_owner_id_key" UNIQUE ("ownerId", "id"),
  CONSTRAINT "EagleTagSemanticBuild_tag_fkey" FOREIGN KEY ("ownerId", "tagId") REFERENCES "EagleManualTag"("ownerId", "id") ON DELETE CASCADE,
  CONSTRAINT "EagleTagSemanticBuild_snapshot_fkey" FOREIGN KEY ("ownerId", "candidateSnapshotId") REFERENCES "EagleTagPrototypeSnapshot"("ownerId", "id") ON DELETE RESTRICT,
  CONSTRAINT "EagleTagSemanticBuild_owner_snapshot_key" UNIQUE ("ownerId", "candidateSnapshotId")
);
CREATE INDEX "EagleTagSemanticBuild_claim_idx" ON "EagleTagSemanticBuild" ("status", "availableAt", "createdAt");
CREATE INDEX "EagleTagSemanticBuild_tag_idx" ON "EagleTagSemanticBuild" ("ownerId", "tagId", "status");
