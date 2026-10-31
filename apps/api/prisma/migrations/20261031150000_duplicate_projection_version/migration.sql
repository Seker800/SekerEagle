BEGIN;
ALTER TABLE "EagleDuplicateGroup" ADD COLUMN "algorithmVersion" TEXT NOT NULL DEFAULT 'legacy';
COMMIT;
