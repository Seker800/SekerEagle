-- The scheduler only needs completed uploads inside the 24h priority horizon.
CREATE INDEX "UploadSession_recent_freshness_cover_idx"
ON "UploadSession" ("completedAt" DESC) INCLUDE ("objectKey", "uploaderId", "libraryMode")
WHERE status = 'COMPLETED';

-- The immutable objectKey unique index remains. The earlier all-history covering
-- lookup is superseded by this bounded time-range access path.
DROP INDEX "UploadSession_completed_freshness_cover_idx";
ANALYZE "UploadSession";
