CREATE TABLE "EagleAssetOperation" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('SEND','TRASH','RESTORE','EMPTY_TRASH')),
 "inputIds" TEXT[] NOT NULL, "authVersion" INTEGER NOT NULL,
 "privateUntil" TIMESTAMP(3), "isPrivate" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EagleAssetOperation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EagleAssetOperation_ownerId_libraryMode_id_key" ON "EagleAssetOperation"("ownerId","libraryMode","id");
CREATE INDEX "EagleAssetOperation_ownerId_libraryMode_createdAt_idx" ON "EagleAssetOperation"("ownerId","libraryMode","createdAt");
CREATE TABLE "EagleAssetOperationItem" (
 "id" TEXT PRIMARY KEY, "operationId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "libraryMode" "LibraryMode" NOT NULL,
 "ordinal" INTEGER NOT NULL, "assetIds" TEXT[] NOT NULL, "snapshots" JSONB NOT NULL, "weight" INTEGER NOT NULL CHECK ("weight">0),
 "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
 "errorCode" TEXT, "leaseUntil" TIMESTAMP(3), "leaseVersion" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EagleAssetOperationItem_scope_fkey" FOREIGN KEY ("ownerId","libraryMode","operationId") REFERENCES "EagleAssetOperation"("ownerId","libraryMode","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EagleAssetOperationItem_operationId_ordinal_key" ON "EagleAssetOperationItem"("operationId","ordinal");
CREATE INDEX "EagleAssetOperationItem_libraryMode_status_leaseUntil_idx" ON "EagleAssetOperationItem"("libraryMode","status","leaseUntil");

CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetOperation" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
CREATE TRIGGER library_mode_immutable BEFORE UPDATE OF "libraryMode" ON "EagleAssetOperationItem" FOR EACH ROW EXECUTE FUNCTION enforce_library_mode_immutable();
