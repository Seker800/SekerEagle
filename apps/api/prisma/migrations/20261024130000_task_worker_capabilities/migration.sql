-- Backward compatible: older workers remain visible with unknown capabilities.
ALTER TABLE "EagleProcessingWorkerHeartbeat" ADD COLUMN "capabilities" JSONB;
