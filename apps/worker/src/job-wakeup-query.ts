import { MEDIA_LEASE_MS } from '@sekereagle/library-core';
import { Prisma, type EagleMediaJobKind } from '@prisma/client';
import { taskPolicySnapshotSql, mediaTaskFamilySql } from '@sekereagle/library-persistence';

/** Match the claim profile so paused jobs cannot cause an idle worker to spin. */
export function buildMediaWakeQuery(allowedJobKinds?: readonly EagleMediaJobKind[]) {
  return Prisma.sql`
      WITH ${taskPolicySnapshotSql()}, pending AS (
        SELECT job.* FROM "EagleMediaJob" job
        WHERE job.status='PENDING' AND job."dependsOnJobId" IS NULL
        UNION ALL
        SELECT job.* FROM "EagleMediaJob" job
        JOIN "EagleMediaJob" dependency ON dependency.id=job."dependsOnJobId"
          AND dependency."ownerId"=job."ownerId" AND dependency."libraryMode"=job."libraryMode"
          AND dependency.status='COMPLETED'
        WHERE job.status='PENDING' AND job."dependsOnJobId" IS NOT NULL
      )
      SELECT candidate."ownerId", candidate."libraryMode", candidate.lane, candidate.kind, candidate."processorVersion",
             MIN(candidate."availableAt") AS "availableAt"
      FROM (
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."availableAt" AS "availableAt"
        FROM pending AS job
        JOIN "EagleAsset" AS asset ON asset.id=job."assetId" AND asset."ownerId"=job."ownerId" AND asset."libraryMode"=job."libraryMode"
        WHERE job."assetRevision"=asset."mediaRevision" AND (asset."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
        UNION ALL
        SELECT job."ownerId", job."libraryMode", job.lane::text AS lane, job.kind::text AS kind, job."processorVersion",
               job."lockedAt" + ${MEDIA_LEASE_MS} * interval '1 millisecond' AS "availableAt"
        FROM "EagleMediaJob" AS job
        JOIN "EagleAsset" AS asset ON asset.id=job."assetId" AND asset."ownerId"=job."ownerId" AND asset."libraryMode"=job."libraryMode"
        WHERE job.status = 'PROCESSING' AND job."lockedAt" IS NOT NULL
          AND job."assetRevision"=asset."mediaRevision" AND (asset."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
      ) AS candidate
      JOIN task_policy_snapshot eligibility ON eligibility."ownerId"=candidate."ownerId" AND eligibility."libraryMode"=candidate."libraryMode"
      WHERE candidate.kind<>'GENERATE_AI_TAGS' AND NOT (${mediaTaskFamilySql(Prisma.sql`candidate.kind`, Prisma.sql`candidate."processorVersion"`)}=ANY(eligibility.paused))
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
