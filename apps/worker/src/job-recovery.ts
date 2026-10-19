import { Prisma } from '@prisma/client';

export function mediaLaneOrder(
  sequence: number,
): Array<'INTERACTIVE' | 'BACKGROUND' | 'MAINTENANCE'> {
  if (sequence % 16 === 15) return ['MAINTENANCE', 'INTERACTIVE', 'BACKGROUND'];
  if (sequence % 4 === 3) return ['BACKGROUND', 'INTERACTIVE', 'MAINTENANCE'];
  return ['INTERACTIVE', 'BACKGROUND', 'MAINTENANCE'];
}

export async function propagateFailedDependencies(
  client: Pick<Prisma.TransactionClient, '$executeRaw'>,
) {
  return client.$executeRaw(Prisma.sql`
    WITH RECURSIVE blocked AS (
      SELECT child.id, child."ownerId", child."libraryMode" FROM "EagleMediaJob" child
      JOIN "EagleMediaJob" parent ON parent.id=child."dependsOnJobId"
        AND parent."ownerId"=child."ownerId" AND parent."libraryMode"=child."libraryMode"
      WHERE child.status='PENDING' AND parent.status='FAILED'
      UNION
      SELECT child.id, child."ownerId", child."libraryMode" FROM "EagleMediaJob" child
      JOIN blocked parent ON parent.id=child."dependsOnJobId"
        AND parent."ownerId"=child."ownerId" AND parent."libraryMode"=child."libraryMode"
      WHERE child.status='PENDING'
    ) UPDATE "EagleMediaJob" job SET status='FAILED', "lastError"='DEPENDENCY_FAILED',
      "completedAt"=now(),"lockedAt"=NULL,"updatedAt"=now()
    FROM blocked WHERE job.id=blocked.id AND job.status='PENDING'
  `);
}
