-- Recovery runs independently for both libraries. Completed upload history has no
-- retired keys and must not be scanned merely to discover an empty cleanup queue.
-- Keep the literal predicate aligned with Prisma's retiredObjectKeys.isEmpty=false.
-- Concurrent construction preserves normal uploads while scanning existing history.
CREATE INDEX CONCURRENTLY "EagleUploadSessionState_retired_cleanup_idx"
ON "EagleUploadSessionState" ("libraryMode", "uploadSessionId")
WHERE "retiredObjectKeys" <> ARRAY[]::text[];
