-- Wake-time failure propagation needs pending dependency edges, not retired history
-- or the independent color/embedding backlog. Cover the recursive join and its result.
CREATE INDEX "EagleMediaJob_pending_dependency_cover_idx"
ON "EagleMediaJob" ("dependsOnJobId", "ownerId", "libraryMode") INCLUDE (id)
WHERE status='PENDING' AND "dependsOnJobId" IS NOT NULL;
