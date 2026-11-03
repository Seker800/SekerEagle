-- Finished and failed processing jobs are retained, so these two tables churn far faster than
-- the default 20% autovacuum threshold assumes. With statistics a day or two old, the worker
-- wake query (every 30s, see apps/worker/src/job-wakeup-query.ts) estimated thousands of ready
-- jobs and hash-joined the whole asset table: 1.2s and ~3 cores per poll on the NAS.
-- Tighter per-table thresholds keep analyze/vacuum close to the churn without a global change.
ALTER TABLE "EagleMediaJob" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_limit = 800
);

ALTER TABLE "EagleAsset" SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
