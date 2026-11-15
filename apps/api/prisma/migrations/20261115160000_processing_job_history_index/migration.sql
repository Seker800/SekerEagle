-- Bounded processing history pages scan recent jobs instead of sorting every retained row.
-- The Prisma model maps to the existing "EagleMediaJob" table.
CREATE INDEX "EagleMediaJob_ownerId_libraryMode_createdAt_id_idx"
  ON "EagleMediaJob" ("ownerId", "libraryMode", "createdAt" DESC, "id" DESC);
