import { Prisma, type PrismaClient, type EagleAssetProcessingJob } from '@prisma/client';
import {
  backgroundScheduleSql,
  taskPolicyAllowsSql,
  taskPrioritySql,
  mediaTaskFamilySql,
} from '@sekereagle/library-persistence';
import type { ClaimFindManyInput } from './job-claim';

/** Apply policies before the bounded candidate window, so paused work cannot hide runnable jobs. */
export function selectScheduledMediaCandidates(
  client: Pick<PrismaClient, '$queryRaw'>,
  input: ClaimFindManyInput,
  preferPriority = true,
  embeddingUnavailable = false,
) {
  const kind = input.where.kind;
  const family = mediaTaskFamilySql(Prisma.sql`job.kind`, Prisma.sql`job."processorVersion"`);
  const priority = taskPrioritySql(
    Prisma.sql`job."ownerId"`,
    Prisma.sql`job."libraryMode"`,
    family,
  );
  return client.$queryRaw<EagleAssetProcessingJob[]>(Prisma.sql`
    SELECT job.* FROM "EagleMediaJob" job JOIN "EagleAsset" a ON a.id=job."assetId" AND a."ownerId"=job."ownerId" AND a."libraryMode"=job."libraryMode"
    LEFT JOIN "EagleMediaJob" dependency ON dependency.id=job."dependsOnJobId" AND dependency."ownerId"=job."ownerId" AND dependency."libraryMode"=job."libraryMode"
    WHERE job.kind<>'GENERATE_AI_TAGS' AND ${embeddingUnavailable ? Prisma.sql`job.kind<>'GENERATE_EMBEDDING' AND` : Prisma.empty}
      (CASE WHEN job."processorVersion"='photo-source-details-v1' THEN 'BACKGROUND'::"EagleProcessingLane" ELSE job.lane END)=${input.where.lane}::"EagleProcessingLane"
      AND ((job.status='PENDING' AND job."availableAt"<=now()) OR (job.status='PROCESSING' AND job."lockedAt"<now()-interval '10 minutes'))
      AND (job."dependsOnJobId" IS NULL OR dependency.status='COMPLETED')
      AND job."assetRevision"=a."mediaRevision" AND (a."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
      AND ${taskPolicyAllowsSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`, family)}
      AND (job.lane<>'BACKGROUND' AND job."processorVersion"<>'photo-source-details-v1' OR ${backgroundScheduleSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`)})
      ${typeof kind === 'string' ? Prisma.sql`AND job.kind::text=${kind}` : Prisma.empty}
      ${typeof kind === 'object' && kind.not ? Prisma.sql`AND job.kind::text<>${kind.not}` : Prisma.empty}
      ${typeof kind === 'object' && kind.in ? Prisma.sql`AND job.kind::text IN (${Prisma.join(kind.in)})` : Prisma.empty}
      ${input.where.processorVersion?.notIn.length ? Prisma.sql`AND job."processorVersion" NOT IN (${Prisma.join(input.where.processorVersion.notIn)})` : Prisma.empty}
    ORDER BY ${preferPriority ? Prisma.sql`${priority} DESC,` : Prisma.empty} job."availableAt",job."createdAt",job.id LIMIT ${input.take}
  `);
}

/** Count fairness independently per lane: reserved background turns must not all become FIFO. */
export function createScheduledMediaSelector(
  client: Pick<PrismaClient, '$queryRaw'>,
  embeddingUnavailable: () => boolean,
) {
  const turns = new Map<string, number>();
  return (input: ClaimFindManyInput) => {
    const turn = turns.get(input.where.lane) ?? 0;
    turns.set(input.where.lane, turn + 1);
    return selectScheduledMediaCandidates(client, input, turn % 4 !== 3, embeddingUnavailable());
  };
}
