import { Prisma } from '@prisma/client';
import { TASK_GATES, TASK_FAMILIES, isBackgroundFamily, MEDIA_LEASE_MS, type TaskGate } from '@sekereagle/library-core';

/** Only adapters know column names; precedence and wait reasons come from the core. */
export function taskWaitReasonSql(facts: Partial<Record<TaskGate, Prisma.Sql>>): Prisma.Sql {
  const gates = TASK_GATES.flatMap(([gate, reason]) => facts[gate]
    ? [Prisma.sql`WHEN ${facts[gate]} THEN ${reason}`] : []);
  return gates.length ? Prisma.sql`CASE ${Prisma.join(gates, ' ')} ELSE ${'QUEUED'} END` : Prisma.sql`'QUEUED'`;
}
/** Filtering before LIMIT is essential: never load a whole owner's queue into JS. */
export function taskRunnableSql(facts: Partial<Record<TaskGate, Prisma.Sql>>): Prisma.Sql {
  const gates = TASK_GATES.flatMap(([gate]) => facts[gate] ? [Prisma.sql`NOT (${facts[gate]})`] : []);
  return gates.length ? Prisma.sql`(${Prisma.join(gates, ' AND ')})` : Prisma.sql`true`;
}
export function backgroundFamilySql(family: Prisma.Sql) {
  return Prisma.sql`${family} IN (${Prisma.join(TASK_FAMILIES.filter(isBackgroundFamily))})`;
}
export function mediaStaleBeforeSql() { return Prisma.sql`now()-${MEDIA_LEASE_MS} * interval '1 millisecond'`; }
