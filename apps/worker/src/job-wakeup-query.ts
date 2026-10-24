import { Prisma, type EagleMediaJobKind } from '@prisma/client';
import { taskPolicyAllowsSql, mediaTaskFamilySql } from '@sekereagle/library-persistence';

/** Match the claim profile so paused jobs cannot cause an idle worker to spin. */
export function buildMediaWakeQuery(allowedJobKinds?: readonly EagleMediaJobKind[]) {
  return Prisma.sql`
      SELECT candidate."ownerId", candidate."libraryMode", candidate.lane, candidate.kind, candidate."processorVersion",
             MIN(candidate."availableAt") AS "availableAt"
      FROM (
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."availableAt" AS "availableAt"
        FROM "EagleMediaJob" AS job
        JOIN "EagleAsset" AS asset ON asset.id=job."assetId" AND asset."ownerId"=job."ownerId" AND asset."libraryMode"=job."libraryMode"
        LEFT JOIN "EagleMediaJob" AS dependency ON dependency.id = job."dependsOnJobId" AND dependency."ownerId"=job."ownerId" AND dependency."libraryMode"=job."libraryMode"
        WHERE job.status = 'PENDING'
          AND job."assetRevision"=asset."mediaRevision" AND (asset."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
          AND (job."dependsOnJobId" IS NULL OR dependency.status = 'COMPLETED')
        UNION ALL
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."lockedAt" + INTERVAL '10 minutes' AS "availableAt"
        FROM "EagleMediaJob" AS job
        JOIN "EagleAsset" AS asset ON asset.id=job."assetId" AND asset."ownerId"=job."ownerId" AND asset."libraryMode"=job."libraryMode"
        WHERE job.status = 'PROCESSING' AND job."lockedAt" IS NOT NULL
          AND job."assetRevision"=asset."mediaRevision" AND (asset."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
      ) AS candidate
      WHERE ${taskPolicyAllowsSql(Prisma.sql`candidate."ownerId"`, Prisma.sql`candidate."libraryMode"`, mediaTaskFamilySql(Prisma.sql`candidate.kind`, Prisma.sql`candidate."processorVersion"`))}
      ${
        allowedJobKinds === undefined
          ? Prisma.empty
          : allowedJobKinds.length
            ? Prisma.sql`AND candidate.kind IN (${Prisma.join([...allowedJobKinds])})`
            : Prisma.sql`AND false`
      }
      GROUP BY candidate."ownerId", candidate."libraryMode", candidate.lane, candidate.kind, candidate."processorVersion"
    `;
}
