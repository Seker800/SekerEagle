BEGIN;

-- Match the authenticated, public PHOTO chronological read prefix without heap visits.
-- Existing chronological index remains necessary when private content is authorized.
CREATE INDEX "EagleAsset_owner_mode_privacy_chronological_idx"
  ON "EagleAsset" ("ownerId", "libraryMode", "isPrivate", "deletedAt", "chronologicalAt", "id");

COMMIT;
