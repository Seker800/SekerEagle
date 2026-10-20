ALTER TABLE "RefreshToken" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
-- Existing active sessions retain their current account version. No secrets are copied.
UPDATE "RefreshToken" AS token SET "authVersion" = account."authVersion"
FROM "User" AS account WHERE account.id = token."userId";
