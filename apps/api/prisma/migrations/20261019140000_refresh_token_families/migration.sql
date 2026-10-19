ALTER TABLE "RefreshToken" ADD COLUMN "familyId" TEXT;
UPDATE "RefreshToken" SET "familyId" = id WHERE "familyId" IS NULL;
ALTER TABLE "RefreshToken" ALTER COLUMN "familyId" SET NOT NULL;
CREATE INDEX "RefreshToken_familyId_revokedAt_idx" ON "RefreshToken" ("familyId", "revokedAt");
