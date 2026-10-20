BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "EagleLibraryTransfer" DROP CONSTRAINT "EagleLibraryTransfer_status_check";
ALTER TABLE "EagleLibraryTransfer" ADD CONSTRAINT "EagleLibraryTransfer_status_check"
  CHECK ("status" IN ('PENDING', 'COMPLETED', 'ABANDONED')) NOT VALID;
ALTER TABLE "EagleLibraryTransfer" VALIDATE CONSTRAINT "EagleLibraryTransfer_status_check";
CREATE INDEX "EagleLibraryTransfer_status_updatedAt_idx" ON "EagleLibraryTransfer" ("status", "updatedAt");
COMMIT;
