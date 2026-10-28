import {
  Prisma,
  type PrismaClient,
  type EagleAssetProcessingJob,
  type EagleMediaJobKind,
} from '@prisma/client';
import {
  backgroundScheduleSql,
  backgroundFamilySql,
  taskRunnableSql,
  mediaTaskFactsSql,
  mediaStaleBeforeSql,
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
    resource?: 'NAS' | 'EMBEDDING' | 'REMOTE_MEDIA';
    freshOnly?: boolean;
    historyOnly?: boolean;
    candidateIds?: readonly string[];
    delegatedImageKinds?: readonly EagleMediaJobKind[];
    delegatedVideoKinds?: readonly EagleMediaJobKind[];
  } = {},
) {
  const kind = input.where.kind;
  const family = mediaTaskFamilySql(Prisma.sql`job.kind`, Prisma.sql`job."processorVersion"`);
  const priority = taskPrioritySql(
    Prisma.sql`job."ownerId"`,
    Prisma.sql`job."libraryMode"`,
    family,
  );
  // Only uploads inside the 24h priority horizon can affect freshness: older
  // uploads cannot promote an old asset or outrank the addedAt of a recent one.
  // The immutable current object key identifies the media version, including replacements.
  // A maintenance job or an upload of a superseded/different owner's object cannot promote it.
  const freshness = Prisma.sql`CASE WHEN job.kind='RENDER_EDITED_COPY' THEN job."createdAt" ELSE GREATEST(a."libraryAddedAt",COALESCE(current_upload."completedAt",a."libraryAddedAt")) END`;
  // Evaluate the small time-indexed upload set once. Joining the full upload table
  // lets nested-loop plans probe an old object key for every queued asset before LIMIT.
  return client.$queryRaw<EagleAssetProcessingJob[]>(Prisma.sql`
    WITH recent_uploads AS MATERIALIZED (
      SELECT "objectKey", "uploaderId", "libraryMode", "completedAt", status
      FROM "UploadSession"
      WHERE "completedAt">=now()-interval '24 hours' AND status='COMPLETED'
    )
    SELECT job.* FROM "EagleMediaJob" job JOIN "EagleAsset" a ON a.id=job."assetId" AND a."ownerId"=job."ownerId" AND a."libraryMode"=job."libraryMode"
    LEFT JOIN recent_uploads current_upload ON current_upload."objectKey"=a."originalObjectKey"
      AND current_upload."completedAt">=now()-interval '24 hours'
      AND current_upload."uploaderId"=a."ownerId" AND current_upload."libraryMode"=a."libraryMode" AND current_upload.status='COMPLETED'
    LEFT JOIN "EagleMediaJob" dependency ON dependency.id=job."dependsOnJobId" AND dependency."ownerId"=job."ownerId" AND dependency."libraryMode"=job."libraryMode"
    WHERE ${options.candidateIds ? Prisma.sql`job.id IN (${Prisma.join(options.candidateIds)}) AND` : Prisma.empty}
      ${options.resource === 'EMBEDDING' ? Prisma.sql`job.kind='GENERATE_EMBEDDING' AND` : options.resource === 'NAS' ? Prisma.sql`job.kind<>'GENERATE_EMBEDDING' AND` : Prisma.empty}
      ${options.resource === 'REMOTE_MEDIA' ? (options.delegatedVideoKinds?.length ? Prisma.sql`((a."mimeType" LIKE 'image/%' AND ${options.delegatedImageKinds?.length ? Prisma.sql`job.kind IN (${Prisma.join(options.delegatedImageKinds.map((k) => Prisma.sql`${k}::"EagleMediaJobKind"`))})` : Prisma.sql`false`}) OR ((a."mimeType" LIKE 'video/%' OR a."mimeType"='application/mxf') AND job.kind IN (${Prisma.join(options.delegatedVideoKinds.map((k) => Prisma.sql`${k}::"EagleMediaJobKind"`))}))) AND` : Prisma.sql`a."mimeType" LIKE 'image/%' AND`) : Prisma.empty}
      ${options.resource === 'NAS' && options.delegatedImageKinds?.length ? Prisma.sql`NOT (a."mimeType" LIKE 'image/%' AND job.kind IN (${Prisma.join(options.delegatedImageKinds.map((k) => Prisma.sql`${k}::"EagleMediaJobKind"`))})) AND` : Prisma.empty}
      ${options.resource === 'NAS' && options.delegatedVideoKinds?.length ? Prisma.sql`NOT ((a."mimeType" LIKE 'video/%' OR a."mimeType"='application/mxf') AND job.kind IN (${Prisma.join(options.delegatedVideoKinds.map((k) => Prisma.sql`${k}::"EagleMediaJobKind"`))})) AND` : Prisma.empty}
      ${options.freshOnly ? Prisma.sql`${freshness}>=now()-interval '24 hours' AND` : Prisma.empty}
      ${options.historyOnly ? Prisma.sql`${freshness}<now()-interval '24 hours' AND` : Prisma.empty}
      job.kind<>'GENERATE_AI_TAGS' AND
      ${
        input.where.lane === 'BACKGROUND'
          ? Prisma.sql`(job.lane='BACKGROUND' OR job."processorVersion"='photo-source-details-v1')`
          : Prisma.sql`(job.lane=${input.where.lane}::"EagleProcessingLane" AND job."processorVersion"<>'photo-source-details-v1')`
      }
      AND (job.status='PENDING' OR (job.status='PROCESSING' AND job."lockedAt"<${mediaStaleBeforeSql()}))
      AND job."assetRevision"=a."mediaRevision" AND (a."deletedAt" IS NULL OR job.kind='PURGE_ASSET')
      AND ${taskRunnableSql({
        paused: Prisma.sql`NOT (${taskPolicyAllowsSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`, family)})`,
        modelOffline: embeddingUnavailable
          ? Prisma.sql`job.kind='GENERATE_EMBEDDING'`
          : Prisma.sql`false`,
        ...mediaTaskFactsSql(Prisma.sql`job`, Prisma.sql`dependency`),
        outsideSchedule: Prisma.sql`${backgroundFamilySql(family)} AND NOT (${backgroundScheduleSql(Prisma.sql`job."ownerId"`, Prisma.sql`job."libraryMode"`)})`,
      })}
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
  resource?: 'NAS' | 'EMBEDDING' | 'REMOTE_MEDIA',
  delegatedImages: () => readonly EagleMediaJobKind[] = () => [],
  delegatedVideos: () => readonly EagleMediaJobKind[] = () => [],
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
    const delegatedImageKinds = delegatedImages();
    const delegatedVideoKinds = delegatedVideos();
    const key = JSON.stringify([
      delegatedImageKinds,
      delegatedVideoKinds,
      input.where.lane,
      input.where.kind,
      input.where.processorVersion,
      age,
      preferPriority,
      unavailable,
    ]);
    const options = {
      resource,
      delegatedImageKinds,
      delegatedVideoKinds,
      freshOnly: age === 'RECENT',
      historyOnly: age === 'HISTORY',
    };
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
          // These are hints, not leases: every use below reruns all current guards.
          // Keep useful windows until consumed (bounded at two minutes), rather
          // than rescanning a large backlog while most of its 50 hints remain.
          window = {
            ids: rows.map((row) => row.id),
            expiresAt: Date.now() + (rows.length ? 120000 : 30000),
          };
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
  selectors: Record<'NAS' | 'EMBEDDING', { invalidate(): void }> &
    Partial<Record<'REMOTE_MEDIA', { invalidate(): void }>>,
  payload?: string,
) {
  if (
    !payload ||
    ['EagleMediaJob', 'EagleProcessingSetting', 'EagleTaskPolicy'].includes(payload)
  ) {
    selectors.NAS.invalidate();
    selectors.REMOTE_MEDIA?.invalidate();
    selectors.EMBEDDING.invalidate();
  } else if (payload === 'media-ready:NAS') {
    selectors.NAS.invalidate();
    selectors.REMOTE_MEDIA?.invalidate();
  } else if (payload === 'media-ready:EMBEDDING') selectors.EMBEDDING.invalidate();
}
