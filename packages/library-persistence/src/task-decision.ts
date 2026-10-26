import { mediaTaskFamilySql } from './task-policy';
import { Prisma } from '@prisma/client';
import {
  TASK_GATES,
  MEDIA_BROWSE_BLOCKING_KINDS,
  TASK_FAMILIES,
  isBackgroundFamily,
  MEDIA_LEASE_MS,
  type TaskGate,
} from '@sekereagle/library-core';

/** Only adapters know column names; precedence and wait reasons come from the core. */
export function taskWaitReasonSql(facts: Partial<Record<TaskGate, Prisma.Sql>>): Prisma.Sql {
  const gates = TASK_GATES.flatMap(([gate, reason]) =>
    facts[gate] ? [Prisma.sql`WHEN ${facts[gate]} THEN ${reason}`] : [],
  );
  return gates.length
    ? Prisma.sql`CASE ${Prisma.join(gates, ' ')} ELSE ${'QUEUED'} END`
    : Prisma.sql`'QUEUED'`;
}
/** Filtering before LIMIT is essential: never load a whole owner's queue into JS. */
export function taskRunnableSql(facts: Partial<Record<TaskGate, Prisma.Sql>>): Prisma.Sql {
  const gates = TASK_GATES.flatMap(([gate]) =>
    facts[gate] ? [Prisma.sql`NOT (${facts[gate]})`] : [],
  );
  return gates.length ? Prisma.sql`(${Prisma.join(gates, ' AND ')})` : Prisma.sql`true`;
}
export function backgroundFamilySql(family: Prisma.Sql) {
  return Prisma.sql`${family} IN (${Prisma.join(TASK_FAMILIES.filter(isBackgroundFamily))})`;
}
export function mediaStaleBeforeSql() {
  return Prisma.sql`now()-${MEDIA_LEASE_MS} * interval '1 millisecond'`;
}

export function mediaBlocksAssetReadySql(kind: Prisma.Sql, version: Prisma.Sql) {
  return Prisma.sql`${kind}::text IN (${Prisma.join(MEDIA_BROWSE_BLOCKING_KINDS)}) AND ${mediaTaskFamilySql(kind, version)}='BROWSE'`;
}


/** Capacity hints expire with the task's retry deadline; they never describe host health. */
export function taskBackoffFactsSql(availableAt: Prisma.Sql, errorCode?: Prisma.Sql) {
  const retryPending = Prisma.sql`${availableAt}>now()`;
  return {
    retryPending,
    modelBusy: errorCode
      ? Prisma.sql`(${retryPending}) AND COALESCE(${errorCode}=${'WAITING_EMBEDDING_CAPACITY'}, false)`
      : Prisma.sql`false`,
  };
}

/** Trusted SQL aliases only. Both queue selection and overview consume these column facts. */
export function mediaTaskFactsSql(job: Prisma.Sql, dependency: Prisma.Sql) {
  const backoff = taskBackoffFactsSql(Prisma.sql`${job}."availableAt"`, Prisma.sql`${job}."lastError"`);
  return {
    dependencyFailed: Prisma.sql`COALESCE(${dependency}.status='FAILED', false)`,
    dependencyPending: Prisma.sql`${job}."dependsOnJobId" IS NOT NULL AND ${dependency}.status IS DISTINCT FROM 'COMPLETED'`,
    retryPending: Prisma.sql`${job}.status='PENDING' AND (${backoff.retryPending})`,
    modelBusy: Prisma.sql`${job}.status='PENDING' AND (${backoff.modelBusy})`,
  };
}
