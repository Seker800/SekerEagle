-- Personal access tokens are explicitly revoked through account controls, password changes,
-- or account disablement. They no longer expire on a fixed calendar deadline.
ALTER TABLE "PersonalAccessToken"
ALTER COLUMN "expiresAt" DROP NOT NULL;

UPDATE "PersonalAccessToken"
SET "expiresAt" = NULL;
