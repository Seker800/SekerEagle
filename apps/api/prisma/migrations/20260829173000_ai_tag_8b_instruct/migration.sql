UPDATE "EagleMediaJob"
SET
  "processorVersion" = 'ollama-concrete-nouns-8b-instruct-v2',
  "lastError" = NULL,
  "availableAt" = NOW(),
  "updatedAt" = NOW()
WHERE kind = 'GENERATE_AI_TAGS'
  AND "processorVersion" = 'ollama-concrete-nouns-v1'
  AND status = 'PENDING';

UPDATE "EagleAiAnalysisRun"
SET
  status = 'SUPERSEDED',
  "completedAt" = COALESCE("completedAt", NOW()),
  "updatedAt" = NOW()
WHERE provider = 'OLLAMA'
  AND "promptVersion" = 'concrete-nouns-zh-v1'
  AND status IN ('PENDING', 'RUNNING');
