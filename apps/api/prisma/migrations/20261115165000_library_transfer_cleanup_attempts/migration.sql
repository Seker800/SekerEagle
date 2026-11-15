-- Delayed object copies get a bounded number of daily cleanup retries, not an endless loop.
ALTER TABLE "EagleLibraryTransfer" ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0;
