-- These fields are correlated by the job planner. Independent estimates greatly
-- undercount embedding backlogs and favor repeated random lookups over bulk joins.
CREATE STATISTICS "EagleMediaJob_scheduler_selectivity" (mcv, dependencies)
ON kind, lane, status, "processorVersion" FROM "EagleMediaJob";
ANALYZE "EagleMediaJob";
