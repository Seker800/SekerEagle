import { Prisma, type EagleMediaJobKind } from '@prisma/client';

/** Match the claim profile so paused jobs cannot cause an idle worker to spin. */
export function buildMediaWakeQuery(allowedJobKinds?: readonly EagleMediaJobKind[]) {
  return Prisma.sql`
      SELECT candidate."ownerId", candidate."libraryMode", candidate.lane, candidate.kind, candidate."processorVersion",
             MIN(candidate."availableAt") AS "availableAt"
      FROM (
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."availableAt" AS "availableAt"
        FROM "EagleMediaJob" AS job
        LEFT JOIN "EagleMediaJob" AS dependency ON dependency.id = job."dependsOnJobId"
        WHERE job.status = 'PENDING'
          AND (job."dependsOnJobId" IS NULL OR dependency.status = 'COMPLETED')
        UNION ALL
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."lockedAt" + INTERVAL '10 minutes' AS "availableAt"
        FROM "EagleMediaJob" AS job
        WHERE job.status = 'PROCESSING' AND job."lockedAt" IS NOT NULL
      ) AS candidate
      ${
        allowedJobKinds === undefined
          ? Prisma.empty
          : allowedJobKinds.length
            ? Prisma.sql`WHERE candidate.kind IN (${Prisma.join([...allowedJobKinds])})`
            : Prisma.sql`WHERE false`
      }
      GROUP BY candidate."ownerId", candidate."libraryMode", candidate.lane, candidate.kind, candidate."processorVersion"
    `;
}
