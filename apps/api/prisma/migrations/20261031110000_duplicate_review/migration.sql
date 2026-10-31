BEGIN;
ALTER TABLE "EagleAssetOperation" DROP CONSTRAINT "EagleAssetOperation_kind_check";
ALTER TABLE "EagleAssetOperation" ADD CONSTRAINT "EagleAssetOperation_kind_check" CHECK ("kind" IN ('SEND','TRASH','RESTORE','EMPTY_TRASH','DUPLICATE_SCAN','DUPLICATE_CLEANUP'));
CREATE TABLE "EagleDuplicateFingerprint" (
 "assetId" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
 "mediaRevision" INTEGER NOT NULL, "processorVersion" TEXT NOT NULL,
 "hash" TEXT NOT NULL CHECK ("hash" ~ '^[0-9a-f]{16}$'), "colors" JSONB NOT NULL,
 "contrast" DOUBLE PRECISION NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EagleDuplicateFingerprint_scope_fkey" FOREIGN KEY ("ownerId","libraryMode","assetId") REFERENCES "EagleAsset"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EagleDuplicateFingerprint_ownerId_libraryMode_assetId_key" ON "EagleDuplicateFingerprint"("ownerId","libraryMode","assetId");
CREATE INDEX "EagleDuplicateFingerprint_ownerId_libraryMode_idx" ON "EagleDuplicateFingerprint"("ownerId","libraryMode");
CREATE TABLE "EagleDuplicateDismissal" (
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "libraryMode" "LibraryMode" NOT NULL, "signature" TEXT NOT NULL CHECK ("signature" ~ '^[0-9a-f]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("ownerId","libraryMode","signature")
);
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleDuplicateFingerprint" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleDuplicateDismissal" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

CREATE TABLE "EagleDuplicateGroup" (
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "libraryMode" "LibraryMode" NOT NULL, "signature" TEXT NOT NULL,
 "assetIds" TEXT[] NOT NULL, "rowVersions" INTEGER[] NOT NULL, "mediaRevisions" INTEGER[] NOT NULL,
 "isPrivate" BOOLEAN NOT NULL, "removableBytes" BIGINT NOT NULL,
 PRIMARY KEY ("ownerId","libraryMode","signature"),
 CHECK (cardinality("assetIds") >= 2 AND cardinality("assetIds") = cardinality("rowVersions") AND cardinality("assetIds") = cardinality("mediaRevisions"))
);
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleDuplicateGroup" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();

COMMIT;
