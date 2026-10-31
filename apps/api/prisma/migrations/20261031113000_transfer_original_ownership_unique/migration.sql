BEGIN;
-- Converge the independently developed ownership migrations without duplicate indexes.
DROP INDEX IF EXISTS "EagleAsset_originalObjectKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EagleAsset_originalObjectKey_owner_key"
  ON "EagleAsset" ("originalObjectKey") WHERE NOT "storageTransferredOut";
DROP INDEX IF EXISTS "EagleAsset_owned_original_key";
COMMIT;
