-- Cancellation is durable across claimed discovery, expansion and executor recovery.
ALTER TABLE "EagleAssetOperation" ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);
