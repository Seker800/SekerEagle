import { Prisma } from '@prisma/client';
import { TASK_EXECUTION_ORDER, taskExecutionPriority, MEDIA_FAMILY_RULES } from '@sekereagle/library-core';

export function taskPolicyAllowsSql(owner: Prisma.Sql, mode: Prisma.Sql, family: Prisma.Sql) {
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "EagleTaskPolicy" policy
    WHERE policy."ownerId"=${owner} AND policy."libraryMode"=${mode} AND policy.family=${family} AND policy.paused)`;
}
/** Legacy owner preferences are intentionally ignored; all owners use the same rules. */
export function taskPrioritySql(_owner: Prisma.Sql, _mode: Prisma.Sql, family: Prisma.Sql) {
  return Prisma.sql`CASE ${family} ${Prisma.join(
    TASK_EXECUTION_ORDER.map((id) => Prisma.sql`WHEN ${id} THEN ${taskExecutionPriority(id)}`),
    ' ',
  )} ELSE 0 END`;
}
export function mediaTaskFamilySql(kind: Prisma.Sql, version: Prisma.Sql) {
  return Prisma.sql`CASE ${Prisma.join(MEDIA_FAMILY_RULES.map((rule) => {
    const condition = rule.version ? Prisma.sql`${version}=${rule.version}`
      : rule.prefix ? Prisma.sql`left(${version},${rule.prefix.length})=${rule.prefix}`
      : Prisma.sql`${kind}::text=${rule.kind}`;
    return Prisma.sql`WHEN ${condition} THEN ${rule.family}`;
  }), ' ')} ELSE 'BROWSE' END`;
}
