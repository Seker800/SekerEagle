BEGIN;
ALTER TABLE "EagleAssetOperationItem"
  DROP CONSTRAINT "EagleAssetOperationItem_status_check",
  ADD CONSTRAINT "EagleAssetOperationItem_status_check"
    CHECK ("status" IN ('PENDING','RUNNING','COMPLETED','SKIPPED','FAILED','CANCELLED'));
COMMIT;
