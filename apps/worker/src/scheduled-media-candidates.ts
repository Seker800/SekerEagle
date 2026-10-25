import { Prisma, type PrismaClient, type EagleAssetProcessingJob } from '@prisma/client';
import {
  backgroundScheduleSql,
  taskPolicyAllowsSql,
  taskPrioritySql,
  mediaTaskFamilySql,
} from '@sekereagle/library-persistence';
import type { MediaQueueAge } from './media-queue-policy';
import type { ClaimFindManyInput } from './job-claim';

/** Apply policies before the bounded candidate window, so paused work cannot hide runnable jobs. */
export function selectScheduledMediaCandidates(
  client: Pick<PrismaClient, '$queryRaw'>,
  input: ClaimFindManyInput,
  preferPriority = true,
  embeddingUnavailable = false,
  options: {
    resource?: 'NAS' | 'EMBEDDING';
    freshOnly?: boolean;
    historyOnly?: boolean;
    candidateIds?: readonly string[];
  } = {},
) {
  const kind = input.where.kind;
  const family = mediaTaskFamilySql(Prisma.sql`job.kind`, Prisma.sql`job."processorVersion"`);
  const priority = taskPrioritySql(
    Prisma.sql`job."ownerId"`,
    Prisma.sql`job."libraryMode"`,
    family,
  );
  // The immutable current object key identifies the media version, including replacements.
  // A maintenance job or an upload of a superseded/different owner's object cannot promote it.
  const freshness = Prisma.sql`CASE WHEN job.kind='RENDER_EDITED_COPY' THEN job."createdAt" ELSE GREATEST(a."libraryAddedAt",COALESCE(current_upload."completedAt",a."libraryAddedAt")) END`;
  return client.$queryRaw<EagleAssetProcessingJob[]>(Prisma.sql`
    SELECT job.* FROM "EagleMediaJob" job JOIN "EagleAsset" a ON a.id=job."assetId" AND a."ownerId"=job."ownerId" AND a."libraryMode"=job."libraryMode"
    LEFT JOIN "UploadSession" current_upload ON current_upload."objectKey"=a."originalObjectKey"
      AND current_upload."completedAt">=now()-interval '24 hours'
      AND current_upload."uploaderId"=a."ownerId" AND current_upload."libraryMode"=a."libraryMode" AND current_upload.status='COMPLETED'
    LEFT JOIN "EagleMediaJob" dependency ON dependency.id=job."dependsOnJobId" AND dependency."ownerId"=job."ownerId" AND dependency."libraryMode"=job."libraryMode"
    WHERE ${options.candidateIds ? Prisma.sql`job.id IN (${Prisma.join(options.candidateIds)}) AND` : Prisma.empty}
      ${options.resource === 'EMBEDDING' ? Prisma.sql`job.kind='GENERATE_EMBEDDING' AND` : options.resource === 'NAS' ? Prisma.sql`job.kind<>'GENERATE_EMBEDDING' AND` : Prisma.empty}
      ${options.freshOnly ? Prisma.sql`${freshness}>=now()-interval '24 hours' AND` : Prisma.empty}
      ${options.historyOnly ? Prisma.sql`${freshness}<now()-interval '24 hours' AND` : Prisma.empty}
      job.kind<>'GENERATE_AI_TAGS'  AND ${embeddingUnavailable ? Prisma.sql`job.kind<>'GENERATE_EMBEDDING' AND` : Prisma.empty}
      ${
        input.where.lane === 'BACKGROUND'
          ? Prisma.sql`(job.lane='BACKGROUND' OR job."processorVersion"='photo-source-details-v1')`
          : Prisma.sql`(job.lane=${input.where.lane}::"EagleProcessingLane" AND job."processorVersion"<>'photo-source-details-v1')`
      }
      AND ((job.status='PENDING' AND job."availableAt"<=now()) OR (job.status='PROCESSING' AND job."lockedAt"<now()-interval '10 minutes'))
      AND (job."dependsOnJobId" IS NULL OR dependency.status='COMPLETED')
      AND job."assetRevision"=a."mediaRevision" AND (a."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
      AND ${taskPolicyAllowsSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`, family)}
      AND (job.lane<>'BACKGROUND' AND job."processorVersion"<>'photo-source-details-v1' OR ${backgroundScheduleSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`)})
      ${typeof kind === 'string' ? Prisma.sql`AND job.kind=${kind}::"EagleMediaJobKind"` : Prisma.empty}
      ${typeof kind === 'object' && kind.not ? Prisma.sql`AND job.kind<>${kind.not}::"EagleMediaJobKind"` : Prisma.empty}
      ${typeof kind === 'object' && kind.in ? Prisma.sql`AND job.kind IN (${Prisma.join(kind.in.map((value) => Prisma.sql`${value}::"EagleMediaJobKind"`))})` : Prisma.empty}
      ${input.where.processorVersion?.notIn.length ? Prisma.sql`AND job."processorVersion" NOT IN (${Prisma.join(input.where.processorVersion.notIn)})` : Prisma.empty}
    ORDER BY (job.kind='RENDER_EDITED_COPY') DESC, (${freshness}>=now()-interval '24 hours') DESC,
      CASE WHEN ${freshness}>=now()-interval '24 hours' THEN ${freshness}
        WHEN a."libraryMode"='PHOTO' THEN a."chronologicalAt" ELSE a."libraryAddedAt" END DESC,
      ${preferPriority ? Prisma.sql`${priority} DESC,` : Prisma.empty} job."availableAt",job."createdAt",job.id LIMIT ${input.take}
  `);
}

/** Count fairness independently per lane: reserved background turns must not all become FIFO. */
export function createScheduledMediaSelector(
  client: Pick<PrismaClient, '$queryRaw'>,
  embeddingUnavailable: () => boolean,
  resource?: 'NAS' | 'EMBEDDING',
) {
  const turns = new Map<string, number>();
  const windows = new Map<string, { ids: string[]; expiresAt: number }>();
  const discoveries = new Map<string, Promise<EagleAssetProcessingJob[]>>();
  let generation = 0;
  const select = async (input: ClaimFindManyInput, age?: MediaQueueAge) => {
    const version = generation;
    const turn = turns.get(input.where.lane) ?? 0;
    turns.set(input.where.lane, turn + 1);
    const preferPriority = turn % 4 !== 3;
    const unavailable = embeddingUnavailable();
    const key = JSON.stringify([
      input.where.lane,
      input.where.kind,
      input.where.processorVersion,
      age,
      preferPriority,
      unavailable,
    ]);
    const options = { resource, freshOnly: age === 'RECENT', historyOnly: age === 'HISTORY' };
    for (let attempt = 0; attempt < 2; attempt++) {
      let window = windows.get(key);
      if (!window || window.expiresAt <= Date.now()) {
        let discovery = discoveries.get(key);
        if (!discovery) {
          discovery = selectScheduledMediaCandidates(
            client,
            input,
            preferPriority,
            unavailable,
            options,
          );
          discoveries.set(key, discovery);
        }
        let rows: EagleAssetProcessingJob[];
        try {
          rows = await discovery;
        } finally {
          if (discoveries.get(key) === discovery) discoveries.delete(key);
        }
        // A notification during discovery must not repopulate an invalidated window.
        if (version !== generation) return [];
        window = windows.get(key);
        if (!window || window.expiresAt <= Date.now()) {
          window = { ids: rows.map((row) => row.id), expiresAt: Date.now() + 30000 };
          if (windows.size >= 24) windows.delete(windows.keys().next().value!);
          windows.set(key, window);
        }
      }
      if (!window.ids.length) return [];
      const rows = await selectScheduledMediaCandidates(
        client,
        input,
        preferPriority,
        unavailable,
        {
          ...options,
          candidateIds: window.ids,
        },
      );
      if (version !== generation) return [];
      window.ids = rows.map((row) => row.id);
      if (rows.length) return rows;
      if (windows.get(key) === window) windows.delete(key);
      // Refill once now: the other resource may stay busy for minutes, and
      // waiting for its completion/30s fallback would leave this resource idle.
    }
    return [];
  };
  return Object.assign(select, {
    invalidate: () => {
      generation++;
      windows.clear();
      discoveries.clear();
    },
  });
}

/** Only new eligible work or policy changes invalidate discovery; leases/heartbeats merely wake. */
export function invalidateMediaCandidates(
  selectors: Record<'NAS' | 'EMBEDDING', { invalidate(): void }>,
  payload?: string,
) {
  if (
    !payload ||
    ['EagleMediaJob', 'EagleProcessingSetting', 'EagleTaskPolicy'].includes(payload)
  ) {
    selectors.NAS.invalidate();
    selectors.EMBEDDING.invalidate();
  } else if (payload === 'media-ready:NAS') selectors.NAS.invalidate();
  else if (payload === 'media-ready:EMBEDDING') selectors.EMBEDDING.invalidate();
}
