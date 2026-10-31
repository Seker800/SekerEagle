BEGIN;
-- Retired handoff identities retain audit pointers; only the current storage owner may be unique.
DROP INDEX "EagleAsset_originalObjectKey_key";
CREATE UNIQUE INDEX "EagleAsset_owned_original_key" ON "EagleAsset"("originalObjectKey") WHERE NOT "storageTransferredOut";
COMMIT;
