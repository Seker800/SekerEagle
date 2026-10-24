-- Retire generation without deleting historical tags, links or analysis results.
UPDATE "EagleProcessingSetting"
SET "aiTagManualEnabled" = false, "aiTagScheduleEnabled" = false, "updatedAt" = now()
WHERE "aiTagManualEnabled" OR "aiTagScheduleEnabled";

UPDATE "EagleMediaJob"
SET status = 'FAILED', "lastError" = 'FEATURE_RETIRED', "completedAt" = now(),
    "lockedAt" = NULL, "leaseVersion" = "leaseVersion" + 1, "updatedAt" = now()
WHERE kind = 'GENERATE_AI_TAGS' AND status IN ('PENDING', 'PROCESSING');

UPDATE "EagleAiAnalysisRun"
SET status = 'FAILED', "errorCode" = 'FEATURE_RETIRED', "completedAt" = now(), "updatedAt" = now()
WHERE provider = 'OLLAMA' AND status IN ('PENDING', 'RUNNING');
