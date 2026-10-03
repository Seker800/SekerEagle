ALTER TABLE "EagleAiAnalysisRun"
ADD COLUMN "processorVersion" TEXT;

-- The v2 prompt was introduced with this processor version. Older prompts remain
-- unversioned rather than being guessed from a possibly pruned job record.
UPDATE "EagleAiAnalysisRun"
SET "processorVersion" = 'ollama-concrete-nouns-8b-instruct-v2'
WHERE provider = 'OLLAMA'
  AND "promptVersion" = 'concrete-nouns-zh-v2';

CREATE INDEX "EagleAiAnalysisRun_completion_lookup_idx"
ON "EagleAiAnalysisRun"("ownerId", "assetId", "assetRevision", "processorVersion", status);

-- A completed analysis is durable even when its queue record was already pruned.
-- Do not touch PROCESSING jobs: a worker may still own their lease.
UPDATE "EagleMediaJob" AS job
SET status = 'COMPLETED',
    "completedAt" = COALESCE(job."completedAt", NOW()),
    "lockedAt" = NULL,
    "lastError" = NULL,
    "updatedAt" = NOW()
WHERE job.kind = 'GENERATE_AI_TAGS'
  AND job.status = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "EagleAiAnalysisRun" AS run
    WHERE run."ownerId" = job."ownerId"
      AND run."assetId" = job."assetId"
      AND run."assetRevision" = job."assetRevision"
      AND run."processorVersion" = job."processorVersion"
      AND run.status IN ('SUCCEEDED', 'SUPERSEDED')
  );
