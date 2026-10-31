import { Prisma } from '@prisma/client';
import { backgroundScheduleSql } from './background-schedule';

/** Statement-local facts: evaluate tiny policies per scope, never once per queued job. */
export function taskPolicySnapshotSql() {
  return Prisma.sql`task_policy_snapshot AS MATERIALIZED (
    SELECT owner.id AS "ownerId", modes.mode AS "libraryMode",
      ${backgroundScheduleSql(Prisma.sql`owner.id`, Prisma.sql`modes.mode`)} AS "inSchedule",
      ARRAY(SELECT policy.family FROM "EagleTaskPolicy" policy WHERE policy."ownerId"=owner.id AND policy."libraryMode"=modes.mode AND policy.paused) AS paused
    FROM "User" owner CROSS JOIN (VALUES ('MATERIAL'::"LibraryMode"),('PHOTO'::"LibraryMode")) modes(mode)
  )`;
}
