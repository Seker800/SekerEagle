BEGIN;
ALTER TABLE "EagleAsset" ADD COLUMN "storageTransferredOut" BOOLEAN NOT NULL DEFAULT false;

-- Audit tombstones retain the original key but never own its lifetime.
DROP INDEX "EagleAsset_originalObjectKey_key";
CREATE UNIQUE INDEX "EagleAsset_originalObjectKey_owner_key"
  ON "EagleAsset" ("originalObjectKey") WHERE NOT "storageTransferredOut";
ALTER TABLE "EagleAsset" ADD CONSTRAINT "EagleAsset_transferred_storage_retired"
  CHECK (NOT "storageTransferredOut" OR
    ("deletedAt" IS NOT NULL AND "purgeAfter" IS NOT NULL AND "transferredAt" IS NOT NULL));

COMMIT;
