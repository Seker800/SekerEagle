ALTER TABLE "RefreshToken" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
-- Old rows have no trustworthy issuance version: fail closed instead of legitimizing
-- sessions created by a password-change race. The first deployment requires sign-in.
UPDATE "RefreshToken" AS token
SET "authVersion" = account."authVersion", "revokedAt" = COALESCE(token."revokedAt", CURRENT_TIMESTAMP)
FROM "User" AS account WHERE account.id = token."userId";
