-- Progress counters are a derived projection of EagleAssetOperationItem.
ALTER TABLE "EagleAssetOperation"
  ADD COLUMN "queuedWeight" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "runningWeight" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedWeight" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "skippedWeight" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failedWeight" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancelledWeight" INTEGER NOT NULL DEFAULT 0;

UPDATE "EagleAssetOperation" o
SET
  "queuedWeight" = c.queued,
  "runningWeight" = c.running,
  "completedWeight" = c.completed,
  "skippedWeight" = c.skipped,
  "failedWeight" = c.failed,
  "cancelledWeight" = c.cancelled
FROM (
  SELECT
    "operationId",
    "ownerId",
    "libraryMode",
    COALESCE(sum("weight") FILTER (WHERE "status" = 'PENDING'), 0)::int AS queued,
    COALESCE(sum("weight") FILTER (WHERE "status" = 'RUNNING'), 0)::int AS running,
    COALESCE(sum("weight") FILTER (WHERE "status" = 'COMPLETED'), 0)::int AS completed,
    COALESCE(sum("weight") FILTER (WHERE "status" = 'SKIPPED'), 0)::int AS skipped,
    COALESCE(sum("weight") FILTER (WHERE "status" = 'FAILED'), 0)::int AS failed,
    COALESCE(sum("weight") FILTER (WHERE "status" = 'CANCELLED'), 0)::int AS cancelled
  FROM "EagleAssetOperationItem"
  GROUP BY 1, 2, 3
) c
WHERE o."id" = c."operationId"
  AND o."ownerId" = c."ownerId"
  AND o."libraryMode" = c."libraryMode";

CREATE OR REPLACE FUNCTION "EagleAssetOperationItem_count_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH counts AS (
    SELECT
      "operationId",
      "ownerId",
      "libraryMode",
      COALESCE(sum("weight") FILTER (WHERE "status" = 'PENDING'), 0)::int AS queued,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'RUNNING'), 0)::int AS running,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'COMPLETED'), 0)::int AS completed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'SKIPPED'), 0)::int AS skipped,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'FAILED'), 0)::int AS failed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'CANCELLED'), 0)::int AS cancelled
    FROM new_rows
    GROUP BY 1, 2, 3
  )
  UPDATE "EagleAssetOperation" o
  SET
    "queuedWeight" = o."queuedWeight" + c.queued,
    "runningWeight" = o."runningWeight" + c.running,
    "completedWeight" = o."completedWeight" + c.completed,
    "skippedWeight" = o."skippedWeight" + c.skipped,
    "failedWeight" = o."failedWeight" + c.failed,
    "cancelledWeight" = o."cancelledWeight" + c.cancelled
  FROM counts c
  WHERE o."id" = c."operationId"
    AND o."ownerId" = c."ownerId"
    AND o."libraryMode" = c."libraryMode";
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "EagleAssetOperationItem_count_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH old_counts AS (
    SELECT
      "operationId", "ownerId", "libraryMode",
      COALESCE(sum("weight") FILTER (WHERE "status" = 'PENDING'), 0)::int AS queued,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'RUNNING'), 0)::int AS running,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'COMPLETED'), 0)::int AS completed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'SKIPPED'), 0)::int AS skipped,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'FAILED'), 0)::int AS failed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'CANCELLED'), 0)::int AS cancelled
    FROM old_rows GROUP BY 1, 2, 3
  ), new_counts AS (
    SELECT
      "operationId", "ownerId", "libraryMode",
      COALESCE(sum("weight") FILTER (WHERE "status" = 'PENDING'), 0)::int AS queued,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'RUNNING'), 0)::int AS running,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'COMPLETED'), 0)::int AS completed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'SKIPPED'), 0)::int AS skipped,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'FAILED'), 0)::int AS failed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'CANCELLED'), 0)::int AS cancelled
    FROM new_rows GROUP BY 1, 2, 3
  ), delta AS (
    SELECT
      COALESCE(n."operationId", o."operationId") AS "operationId",
      COALESCE(n."ownerId", o."ownerId") AS "ownerId",
      COALESCE(n."libraryMode", o."libraryMode") AS "libraryMode",
      COALESCE(n.queued, 0) - COALESCE(o.queued, 0) AS queued,
      COALESCE(n.running, 0) - COALESCE(o.running, 0) AS running,
      COALESCE(n.completed, 0) - COALESCE(o.completed, 0) AS completed,
      COALESCE(n.skipped, 0) - COALESCE(o.skipped, 0) AS skipped,
      COALESCE(n.failed, 0) - COALESCE(o.failed, 0) AS failed,
      COALESCE(n.cancelled, 0) - COALESCE(o.cancelled, 0) AS cancelled
    FROM new_counts n
    FULL JOIN old_counts o
      ON o."operationId" = n."operationId"
      AND o."ownerId" = n."ownerId"
      AND o."libraryMode" = n."libraryMode"
  )
  UPDATE "EagleAssetOperation" op
  SET
    "queuedWeight" = op."queuedWeight" + d.queued,
    "runningWeight" = op."runningWeight" + d.running,
    "completedWeight" = op."completedWeight" + d.completed,
    "skippedWeight" = op."skippedWeight" + d.skipped,
    "failedWeight" = op."failedWeight" + d.failed,
    "cancelledWeight" = op."cancelledWeight" + d.cancelled
  FROM delta d
  WHERE op."id" = d."operationId"
    AND op."ownerId" = d."ownerId"
    AND op."libraryMode" = d."libraryMode"
    AND (d.queued <> 0 OR d.running <> 0 OR d.completed <> 0 OR d.skipped <> 0 OR d.failed <> 0 OR d.cancelled <> 0);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "EagleAssetOperationItem_count_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  WITH counts AS (
    SELECT
      "operationId", "ownerId", "libraryMode",
      COALESCE(sum("weight") FILTER (WHERE "status" = 'PENDING'), 0)::int AS queued,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'RUNNING'), 0)::int AS running,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'COMPLETED'), 0)::int AS completed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'SKIPPED'), 0)::int AS skipped,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'FAILED'), 0)::int AS failed,
      COALESCE(sum("weight") FILTER (WHERE "status" = 'CANCELLED'), 0)::int AS cancelled
    FROM old_rows GROUP BY 1, 2, 3
  )
  UPDATE "EagleAssetOperation" o
  SET
    "queuedWeight" = o."queuedWeight" - c.queued,
    "runningWeight" = o."runningWeight" - c.running,
    "completedWeight" = o."completedWeight" - c.completed,
    "skippedWeight" = o."skippedWeight" - c.skipped,
    "failedWeight" = o."failedWeight" - c.failed,
    "cancelledWeight" = o."cancelledWeight" - c.cancelled
  FROM counts c
  WHERE o."id" = c."operationId"
    AND o."ownerId" = c."ownerId"
    AND o."libraryMode" = c."libraryMode";
  RETURN NULL;
END;
$$;

CREATE TRIGGER "EagleAssetOperationItem_count_insert"
AFTER INSERT ON "EagleAssetOperationItem"
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "EagleAssetOperationItem_count_insert"();

CREATE TRIGGER "EagleAssetOperationItem_count_update"
AFTER UPDATE ON "EagleAssetOperationItem"
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION "EagleAssetOperationItem_count_update"();

CREATE TRIGGER "EagleAssetOperationItem_count_delete"
AFTER DELETE ON "EagleAssetOperationItem"
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION "EagleAssetOperationItem_count_delete"();
