-- Adding a constant DEFAULT libraryMode does not rewrite existing rows. Until
-- ANALYZE runs, PostgreSQL underestimates each library's rows and can repeatedly
-- scan the full tag-link aggregate for every tag. Refresh planner statistics as
-- part of the upgrade, before requests resume; no business rows are changed.
ANALYZE "EagleAsset", "EagleAssetManualTag", "EagleManualTag", "EagleManualTagGroupMembership";
