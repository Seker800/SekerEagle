-- CreateTable
CREATE TABLE "EagleSmartFolderSemanticSnapshot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL,
    "folderId" TEXT NOT NULL,
    "intentKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "breadth" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "spaceId" TEXT NOT NULL,
    "queryVector" vector(1024),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "cursor" TEXT NOT NULL DEFAULT '',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EagleSmartFolderSemanticSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EagleSmartFolderSemanticMatch" (
    "ownerId" TEXT NOT NULL,
    "libraryMode" "LibraryMode" NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "embeddingId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "EagleSmartFolderSemanticMatch_pkey" PRIMARY KEY ("snapshotId","embeddingId")
);

-- CreateIndex
CREATE INDEX "EagleSmartFolderSemanticSnapshot_status_availableAt_lockedU_idx" ON "EagleSmartFolderSemanticSnapshot"("status", "availableAt", "lockedUntil");

-- CreateIndex
CREATE INDEX "EagleSmartFolderSemanticSnapshot_ownerId_libraryMode_folder_idx" ON "EagleSmartFolderSemanticSnapshot"("ownerId", "libraryMode", "folderId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolderSemanticSnapshot_ownerId_libraryMode_id_key" ON "EagleSmartFolderSemanticSnapshot"("ownerId", "libraryMode", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EagleSmartFolderSemanticSnapshot_ownerId_libraryMode_folder_key" ON "EagleSmartFolderSemanticSnapshot"("ownerId", "libraryMode", "folderId", "intentKey");

-- CreateIndex
CREATE INDEX "EagleSmartFolderSemanticMatch_ownerId_libraryMode_embedding_idx" ON "EagleSmartFolderSemanticMatch"("ownerId", "libraryMode", "embeddingId");

-- CreateIndex
CREATE INDEX "EagleSmartFolderSemanticMatch_ownerId_libraryMode_snapshotI_idx" ON "EagleSmartFolderSemanticMatch"("ownerId", "libraryMode", "snapshotId", "similarity", "embeddingId");

-- AddForeignKey
ALTER TABLE "EagleSmartFolderSemanticSnapshot" ADD CONSTRAINT "EagleSmartFolderSemanticSnapshot_ownerId_libraryMode_folde_fkey" FOREIGN KEY ("ownerId", "libraryMode", "folderId") REFERENCES "EagleSmartFolder"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderSemanticMatch" ADD CONSTRAINT "EagleSmartFolderSemanticMatch_ownerId_libraryMode_snapshot_fkey" FOREIGN KEY ("ownerId", "libraryMode", "snapshotId") REFERENCES "EagleSmartFolderSemanticSnapshot"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EagleSmartFolderSemanticMatch" ADD CONSTRAINT "EagleSmartFolderSemanticMatch_ownerId_libraryMode_embeddin_fkey" FOREIGN KEY ("ownerId", "libraryMode", "embeddingId") REFERENCES "EagleAssetEmbedding"("ownerId", "libraryMode", "id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE UNIQUE INDEX "EagleSmartFolderSemanticSnapshot_one_active"
ON "EagleSmartFolderSemanticSnapshot" ("ownerId", "libraryMode", "folderId") WHERE "isActive";
ALTER TABLE "EagleSmartFolderSemanticSnapshot" ADD CONSTRAINT "smart_folder_snapshot_valid"
CHECK (status IN ('PENDING','BUILDING','READY','FAILED') AND threshold >= 0 AND threshold <= 1
  AND breadth IN ('STRICT','BALANCED','BROAD') AND length(text) BETWEEN 1 AND 500
  AND (NOT "isActive" OR (status='READY' AND "queryVector" IS NOT NULL)));
ALTER TABLE "EagleSmartFolderSemanticMatch" ADD CONSTRAINT "smart_folder_similarity_valid"
CHECK (similarity >= -1 AND similarity <= 1);

-- Cached memberships must never survive replacement of the underlying pixels.
-- Asset row locks serialize publication with replacement, including old-space snapshots.
CREATE FUNCTION eagle_validate_smart_folder_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset_revision integer; embedding_revision integer;
BEGIN
  SELECT a."mediaRevision", e."assetRevision" INTO asset_revision, embedding_revision
  FROM "EagleAssetEmbedding" e JOIN "EagleAsset" a
    ON a.id=e."assetId" AND a."ownerId"=e."ownerId" AND a."libraryMode"=e."libraryMode"
  WHERE e.id=NEW."embeddingId" AND e."ownerId"=NEW."ownerId" AND e."libraryMode"=NEW."libraryMode"
  FOR SHARE OF a;
  IF asset_revision IS NULL OR asset_revision <> embedding_revision THEN
    RAISE EXCEPTION 'SMART_FOLDER_EMBEDDING_NOT_CURRENT' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER eagle_smart_folder_match_revision BEFORE INSERT OR UPDATE ON "EagleSmartFolderSemanticMatch"
FOR EACH ROW EXECUTE FUNCTION eagle_validate_smart_folder_match();
CREATE FUNCTION eagle_invalidate_smart_folder_matches() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "EagleSmartFolderSemanticMatch" m USING "EagleAssetEmbedding" e
  WHERE m."embeddingId"=e.id AND e."ownerId"=NEW."ownerId" AND e."libraryMode"=NEW."libraryMode"
    AND e."assetId"=NEW.id AND e."assetRevision" <> NEW."mediaRevision";
  RETURN NEW;
END $$;
CREATE TRIGGER eagle_smart_folder_replace AFTER UPDATE OF "mediaRevision" ON "EagleAsset"
FOR EACH ROW WHEN (OLD."mediaRevision" IS DISTINCT FROM NEW."mediaRevision")
EXECUTE FUNCTION eagle_invalidate_smart_folder_matches();
