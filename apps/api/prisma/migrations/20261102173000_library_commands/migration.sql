-- Existing durable operation lifecycle, with explicit domain extension protocols.
ALTER TABLE "EagleAssetOperation"
  DROP CONSTRAINT "EagleAssetOperation_kind_check",
  ADD CONSTRAINT "EagleAssetOperation_kind_check"
    CHECK ("kind" IN ('SEND','TRASH','RESTORE','EMPTY_TRASH','DUPLICATE_SCAN','DUPLICATE_CLEANUP','METADATA_COMMAND','BACKGROUND_COMMAND'));
-- Discovery/splitting checkpoints retain receipts but transfer all resource weight
-- to their newly persisted children in the same publication transaction.
ALTER TABLE "EagleAssetOperationItem"
  DROP CONSTRAINT "EagleAssetOperationItem_weight_check",
  ADD CONSTRAINT "EagleAssetOperationItem_weight_check" CHECK (weight >= 0);
