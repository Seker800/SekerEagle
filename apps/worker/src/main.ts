import { createPrismaAdapter } from '@sekereagle/library-persistence';
import { PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION } from '@sekereagle/library-core';
import { mediaMemoryMiB, WORKER_INFLIGHT_MEMORY_MIB } from './media-resource-budget';
import { computePolicySignature } from './compute-runtime';
import { RemoteMediaClient } from './remote-media';
import { remoteMediaKinds, remoteImageKinds, remoteVideoKinds } from './compute-runtime';
import {
  mediaWaitData,
  mediaExecutionGuard,
  MediaLeaseRecoveryExhaustedError,
} from '@sekereagle/library-core';
import { mediaQueueAgeOrder } from './media-queue-policy';
import { MediaResourcePool, type MediaResource } from './media-resource-pool';
import { canAdvancePhotoMap, runPhotoMapBuildStep } from './photo-map-build';
import { reconcileSmartFolderSpaces, runSmartFolderBuildStep } from './smart-folder-build';
import { SmartFolderBuildRunner } from './smart-folder-runner';
import { EmbeddingProcessor } from './embedding-job';
import { createCompatibleTextEmbedding } from './embedding-space';
import { createTopEmbeddingSuggestion } from './embedding-suggestions';
import { buildMediaWakeQuery } from './job-wakeup-query';
import {
  VIDEO_PLAYBACK_PROCESSOR_VERSION,
  videoTranscodingEnabled,
} from './video-processing-policy';
import { backgroundProcessingEnabled, mediaBackgroundAllowed } from './processing-policy';
import type { BackgroundSchedule } from '@sekereagle/library-core';
import { claimNextScheduledTagBuild } from './tag-build-lease';
import { recordWorkerHeartbeat } from './worker-health';
import { mediaLaneOrder, propagateFailedDependencies } from './job-recovery';
import { ObjectDeletionRunner } from './object-deletion-runner';
import { nextBackgroundTime } from '@sekereagle/library-core';
import { randomUUID } from 'node:crypto';
import { boundedInteger, boundedNumber } from './bounded';
import { failJob } from './handlers/failure';
import { processJob } from './handlers/registry';
import { readBoundedBytes } from './handlers/shared';
import { failTagSemanticBuild, processTagSemanticBuild } from './tag-semantic-job';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import {
  Prisma,
  PrismaClient,
  type EagleAssetProcessingJob,
  type EagleTagSemanticBuild,
  type LibraryMode,
} from '@prisma/client';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from '@sekereagle/config';
import { parseProcessingJobKinds, availableProcessingJobKinds } from './processing-policy';
import { stopFaceInference } from './photo-faces';
import {
  createScheduledMediaSelector,
  invalidateMediaCandidates,
} from './scheduled-media-candidates';
import { taskPolicyAllowsSql } from '@sekereagle/library-persistence';
import { claimNextMediaJob } from './job-claim';
import { EmbeddingClient } from './embedding-client';
import {
  JobWakeScheduler,
  nextEligibleWakeAt,
  PostgresWakeListener,
  type ProcessingWakeSettings,
} from './job-wakeup';

const SETTINGS_CACHE_MS = 1_000;
const settingsCache = new Map<string, { at: number; settings: BackgroundSchedule | null }>();
const inFlightJobs = new Map<string, EagleAssetProcessingJob>();
const STOP_GRACE_MS = 20_000;

const databaseUrl = process.env.DATABASE_URL ?? '';
const s3Endpoint = process.env.S3_ENDPOINT ?? '';
const s3Bucket = process.env.S3_BUCKET ?? '';
assertSafeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket });
process.stdout.write(
  `SekerEagle worker target: ${describeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket })}\n`,
);

const workerId = `worker-${randomUUID()}`;
const workerVersion = 'v1';
const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
const storage = new S3Client({
  endpoint: s3Endpoint,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
});
let embeddingReadiness: 'READY' | 'OFFLINE' | 'DRIFTED' = 'OFFLINE';
let checkingHeartbeat = false;
let heartbeatTimer: NodeJS.Timeout | undefined;
let wakeScheduler: JobWakeScheduler | undefined;
let wakeListener: PostgresWakeListener | undefined;
let smartFolderRunner: SmartFolderBuildRunner | undefined;
let buildingSmartFolder = false;
let buildingPhotoMap = false;
let lastPhotoMapStep = 0;
let stopping = false;
let activeTagBuildCount = 0;
let objectDeletionRunner: ObjectDeletionRunner | undefined;
const runBackgroundProcessing = backgroundProcessingEnabled(
  process.env.EAGLE_BACKGROUND_PROCESSING_ENABLED,
);
const configuredJobKinds = parseProcessingJobKinds(process.env.EAGLE_PROCESSING_JOB_KINDS);
const facesConfigured = Boolean(process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR);
let allowedJobKinds = availableProcessingJobKinds(configuredJobKinds, facesConfigured);
const runTagBuilds = runBackgroundProcessing && configuredJobKinds === undefined;
const runVideoTranscoding = videoTranscodingEnabled(process.env.EAGLE_VIDEO_TRANSCODING_ENABLED);
const configuredConcurrency = Number(process.env.EAGLE_INTERACTIVE_CONCURRENCY ?? '1');
const workerConcurrency = Number.isSafeInteger(configuredConcurrency)
  ? Math.min(4, Math.max(1, configuredConcurrency))
  : 1;
const resourcePool = new MediaResourcePool(
  workerConcurrency,
  () => wakeScheduler?.wakeNow(),
  reportLoopError,
  boundedInteger(process.env.EAGLE_EMBEDDING_CONCURRENCY, 1, 1, 2),
  WORKER_INFLIGHT_MEMORY_MIB,
);
const legacyEmbeddingLimit = boundedInteger(process.env.EAGLE_EMBEDDING_CONCURRENCY, 1, 1, 2);
const remoteMediaClient = new RemoteMediaClient(
  process.env.MLX_EMBEDDING_URL ?? 'http://host.docker.internal:11435',
  process.env.MLX_EMBEDDING_TOKEN ?? '',
);
const embeddingSpaceId = process.env.MLX_EMBEDDING_SPACE_ID ?? 'qwen3-vl-embedding-2b-1024-v1';
const embeddingModel = process.env.MLX_EMBEDDING_MODEL ?? 'Qwen/Qwen3-VL-Embedding-2B';
const embeddingRevision =
  process.env.MLX_EMBEDDING_REVISION ?? '9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda';
const embeddingDimensions = 1024;
const embeddingClient = new EmbeddingClient({
  baseUrl: process.env.MLX_EMBEDDING_URL ?? 'http://host.docker.internal:11435',
  token: process.env.MLX_EMBEDDING_TOKEN ?? '',
  modelId: embeddingModel,
  modelRevision: embeddingRevision,
  dimensions: embeddingDimensions,
  timeoutMs: boundedInteger(process.env.MLX_EMBEDDING_TIMEOUT_MS, 120_000, 1_000, 600_000),
  maxPayloadBytes: boundedInteger(
    process.env.MLX_EMBEDDING_MAX_PAYLOAD_BYTES,
    20 * 1024 * 1024,
    1,
    50 * 1024 * 1024,
  ),
});

const embeddingIdentity = Object.freeze({
  id: embeddingSpaceId,
  model: embeddingModel,
  revision: embeddingRevision,
  dimensions: embeddingDimensions,
  normalized: true,
  instructionVersion: 'image-retrieval-v1',
  preprocessingVersion: 'preview-webp-v1',
});

async function heartbeat(): Promise<void> {
  if (checkingHeartbeat) return;
  checkingHeartbeat = true;
  try {
    const previousReadiness = embeddingReadiness;
    const previousCompute = computePolicySignature(embeddingClient.computeRuntime);
    embeddingReadiness = await embeddingClient.readiness();
    const runtime = embeddingClient.computeRuntime;
    resourcePool.setEmbeddingLimit(runtime?.backgroundLimit ?? legacyEmbeddingLimit);
    const remoteKinds = remoteMediaKinds(runtime);
    allowedJobKinds = availableProcessingJobKinds(
      configuredJobKinds,
      facesConfigured || remoteKinds.includes('ANALYZE_PHOTO_FACES'),
    );
    resourcePool.setRemoteMediaLimit(
      Math.min(
        16,
        runtime?.nodes
          .filter(
            (n) =>
              n.enabled &&
              n.health === 'READY' &&
              n.operations.some((op) => ['image', 'faces', 'pyramid', 'video'].includes(op)),
          )
          .reduce((sum, n) => sum + n.concurrency, 0) ?? 0,
      ),
    );
    const now = new Date();
    const capabilities = {
      embedding: embeddingReadiness,
      background: runBackgroundProcessing,
      jobKinds: allowedJobKinds ? [...allowedJobKinds] : null,
      video: runVideoTranscoding,
      tagBuilds: runTagBuilds,
      smartFolders:
        runBackgroundProcessing &&
        (!allowedJobKinds || allowedJobKinds.includes('GENERATE_EMBEDDING')),
      photoMap: runBackgroundProcessing,
      faces: facesConfigured || remoteKinds.includes('ANALYZE_PHOTO_FACES'),
      compute: runtime ? (JSON.parse(JSON.stringify(runtime)) as Prisma.InputJsonValue) : null,
    };
    await prisma.eagleProcessingWorkerHeartbeat.upsert({
      where: { workerId },
      create: {
        workerId,
        version: workerVersion,
        startedAt: now,
        heartbeatAt: now,
        activeJobCount: resourcePool.activeCount,
        capabilities,
      },
      update: { heartbeatAt: now, activeJobCount: resourcePool.activeCount, capabilities },
    });
    await recordWorkerHeartbeat();
    if (previousCompute !== computePolicySignature(runtime)) {
      selectors.LOCAL.invalidate();
      selectors.REMOTE_MEDIA.invalidate();
      selectors.EMBEDDING.invalidate();
      wakeScheduler?.wakeNow();
    }
    if (previousReadiness !== embeddingReadiness) {
      selectors.EMBEDDING.invalidate();
      wakeScheduler?.wakeNow();
    }
  } finally {
    checkingHeartbeat = false;
  }
}

const selectors = {
  REMOTE_MEDIA: createScheduledMediaSelector(
    prisma,
    () => embeddingReadiness !== 'READY',
    'REMOTE_MEDIA',
    () => remoteImageKinds(embeddingClient.computeRuntime),
    () => remoteVideoKinds(embeddingClient.computeRuntime),
  ),
  LOCAL: createScheduledMediaSelector(
    prisma,
    () => embeddingReadiness !== 'READY',
    'LOCAL',
    () => remoteImageKinds(embeddingClient.computeRuntime),
    () => remoteVideoKinds(embeddingClient.computeRuntime),
  ),
  EMBEDDING: createScheduledMediaSelector(
    prisma,
    () => embeddingReadiness !== 'READY',
    'EMBEDDING',
  ),
};
const claimSequence: Record<MediaResource, number> = { LOCAL: 0, EMBEDDING: 0, REMOTE_MEDIA: 0 };
async function claimJob(resource: MediaResource): Promise<EagleAssetProcessingJob | null> {
  if (
    stopping ||
    (resource === 'EMBEDDING' && (!runBackgroundProcessing || embeddingReadiness !== 'READY'))
  )
    return null;
  const remoteKinds = remoteMediaKinds(embeddingClient.computeRuntime);
  const claimKinds =
    resource === 'REMOTE_MEDIA'
      ? remoteKinds.filter((k) => !allowedJobKinds || allowedJobKinds.includes(k))
      : resource === 'LOCAL' && !facesConfigured
        ? availableProcessingJobKinds(allowedJobKinds, false)
        : allowedJobKinds;
  if (resource === 'REMOTE_MEDIA' && !remoteKinds.length) return null;
  const sequence = claimSequence[resource]++;
  for (const age of mediaQueueAgeOrder(sequence)) {
    const job = await claimNextMediaJob(prisma, {
      onLeaseExhausted: (job, expiredBefore) =>
        failJob(job, new MediaLeaseRecoveryExhaustedError(expiredBefore), mediaJobContext),
      selectCandidates: (input) => selectors[resource](input, age),
      canClaimBackground: canClaimBackgroundForOwner,
      allowedJobKinds: claimKinds,
      excludedProcessorVersions: runVideoTranscoding ? [] : [VIDEO_PLAYBACK_PROCESSOR_VERSION],
      laneOrder: resource === 'EMBEDDING' ? ['BACKGROUND'] : mediaLaneOrder(sequence),
    });
    if (job) return job;
  }
  return null;
}

async function canClaimBackgroundForOwner(
  ownerId: string,
  kind: EagleAssetProcessingJob['kind'],
  libraryMode: LibraryMode,
  processorVersion?: string,
): Promise<boolean> {
  if (processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION && !runVideoTranscoding) return false;
  if (!runBackgroundProcessing) return false;
  if (kind === 'GENERATE_EMBEDDING' && embeddingReadiness !== 'READY') return false;
  const key = `${ownerId}:${libraryMode}`;
  const cached = settingsCache.get(key);
  let settings: BackgroundSchedule | null;
  if (cached && Date.now() - cached.at < SETTINGS_CACHE_MS) {
    settings = cached.settings;
  } else {
    settings = await prisma.eagleProcessingSetting.findUnique({
      where: { ownerId_libraryMode: { ownerId, libraryMode } },
    });
    if (settingsCache.size >= 16 && !settingsCache.has(key))
      settingsCache.delete(settingsCache.keys().next().value!);
    settingsCache.set(key, { at: Date.now(), settings });
  }
  return mediaBackgroundAllowed(settings, kind);
}

const createTopSuggestion = (
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  embeddingId: string,
) =>
  createTopEmbeddingSuggestion(
    transaction,
    ownerId,
    libraryMode,
    assetId,
    embeddingId,
    boundedNumber(process.env.EAGLE_VECTOR_MINIMUM_SCORE, 0.3, -1, 1),
  );

const embeddingProcessor = new EmbeddingProcessor({
  client: prisma,
  identity: embeddingIdentity,
  hasCredentials: Boolean(process.env.MLX_EMBEDDING_TOKEN?.trim()),
  embedImage: (bytes, mimeType) => embeddingClient.embedImage(bytes, mimeType),
  readSource: (source) => readBoundedBytes(source, 20 * 1024 * 1024),
  suggest: createTopSuggestion,
});

const mediaJobContext = {
  prisma,
  storage,
  s3Bucket,
  remoteMediaClient,
  embeddingProcessor,
  runVideoTranscoding,
  facesConfigured,
  remoteKinds: () => remoteMediaKinds(embeddingClient.computeRuntime),
  resourcePool,
  embeddingSpaceId,
  embeddingDimensions,
};

const tagBuildContext = {
  prisma,
  embeddingSpaceId,
  embeddingDimensions,
  resourcePool,
};

async function deleteOwnedPrefix(ownerId: string, prefix: string): Promise<void> {
  assertOwnedKey(ownerId, `${prefix}placeholder`);
  let continuationToken: string | undefined;
  do {
    const page = await storage.send(
      new ListObjectsV2Command({
        Bucket: s3Bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (page.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : []));
    for (const key of keys) assertOwnedKey(ownerId, key);
    if (keys.length) {
      const result = await storage.send(
        new DeleteObjectsCommand({
          Bucket: s3Bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (result.Errors?.length) throw new Error('OBJECT_PREFIX_DELETION_INCOMPLETE');
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

function resourceBudget(resource: MediaResource) {
  return {
    memoryMiB: (job: EagleAssetProcessingJob) => mediaMemoryMiB(resource, job),
    onMemoryWait: async (job: EagleAssetProcessingJob) => {
      await prisma.eagleAssetProcessingJob.updateMany({
        where: mediaExecutionGuard(job),
        data: mediaWaitData(job.attempts, 1000, 'WAITING_COMPUTE_MEMORY'),
      });
    },
  };
}
async function poll(): Promise<void> {
  if (!stopping) objectDeletionRunner?.wake();
  if (!stopping && runTagBuilds && activeTagBuildCount === 0) {
    const build = await claimNextScheduledTagBuild(prisma);
    if (build) {
      activeTagBuildCount++;
      void processClaimedTagBuild(build).catch(reportLoopError);
    }
  }
  if (stopping) return;
  void resourcePool
    .fill('EMBEDDING', () => claimJob('EMBEDDING'), processClaimedJob, resourceBudget('EMBEDDING'))
    .catch(reportLoopError);
  void resourcePool
    .fill(
      'REMOTE_MEDIA',
      () => claimJob('REMOTE_MEDIA'),
      (job) => processClaimedJob(job, true),
      resourceBudget('REMOTE_MEDIA'),
    )
    .catch(reportLoopError);
  if (resourcePool.active('LOCAL') >= workerConcurrency || buildingPhotoMap) return;
  if (
    runBackgroundProcessing &&
    activeTagBuildCount === 0 &&
    !buildingSmartFolder &&
    !buildingPhotoMap &&
    canAdvancePhotoMap(
      Date.now(),
      lastPhotoMapStep,
      resourcePool.active('LOCAL'),
      workerConcurrency,
    )
  ) {
    buildingPhotoMap = true;
    lastPhotoMapStep = Date.now();
    try {
      await runPhotoMapBuildStep(prisma);
    } catch (error) {
      reportLoopError(error);
    } finally {
      buildingPhotoMap = false;
    }
  }

  void resourcePool
    .fill('LOCAL', () => claimJob('LOCAL'), processClaimedJob, resourceBudget('LOCAL'))
    .catch(reportLoopError);
}

interface PendingMediaWakeRow {
  ownerId: string;
  libraryMode: LibraryMode;
  lane: EagleAssetProcessingJob['lane'];
  kind: EagleAssetProcessingJob['kind'];
  availableAt: Date;
  processorVersion: string;
}

async function nextQueueWakeAt(now = new Date()): Promise<Date | null> {
  const [mediaCandidates, tagBuilds, settings] = await Promise.all([
    prisma.$queryRaw<PendingMediaWakeRow[]>(buildMediaWakeQuery(allowedJobKinds)),
    runTagBuilds
      ? prisma.$queryRaw<Array<{ ownerId: string; libraryMode: LibraryMode; availableAt: Date }>>(
          Prisma.sql`SELECT b."ownerId",b."libraryMode",min(b."availableAt") AS "availableAt" FROM "EagleTagSemanticBuild" b WHERE b.status='PENDING' AND ${taskPolicyAllowsSql(Prisma.sql`b."ownerId"`, Prisma.sql`b."libraryMode"`, Prisma.sql`'TAG_INDEX'`)} GROUP BY b."ownerId",b."libraryMode"`,
        )
      : Promise.resolve([]),
    prisma.eagleProcessingSetting.findMany(),
  ]);
  const settingsByOwner = new Map(
    settings.map(
      (row) =>
        [JSON.stringify([row.ownerId, row.libraryMode]), normalizeWakeSettings(row)] as const,
    ),
  );
  let earliest: Date | null = null;
  for (const build of tagBuilds) {
    const due = new Date(Math.max(now.getTime(), build.availableAt?.getTime() ?? now.getTime()));
    const next = nextBackgroundTime(
      settingsByOwner.get(JSON.stringify([build.ownerId, build.libraryMode])) ??
        defaultWakeSettings(),
      due,
    );
    if (next && (!earliest || next < earliest)) earliest = next;
  }
  for (const candidate of mediaCandidates) {
    if (candidate.kind === 'GENERATE_EMBEDDING' && embeddingReadiness !== 'READY') continue;
    if (candidate.processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION && !runVideoTranscoding)
      continue;
    if (
      !runBackgroundProcessing &&
      (candidate.lane === 'BACKGROUND' ||
        candidate.processorVersion === PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION)
    )
      continue;
    const wakeAt = nextEligibleWakeAt(
      {
        ...candidate,
        lane:
          candidate.processorVersion === PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION
            ? 'BACKGROUND'
            : candidate.lane,
      },
      settingsByOwner.get(JSON.stringify([candidate.ownerId, candidate.libraryMode])) ??
        defaultWakeSettings(),
      now,
    );
    if (wakeAt && (!earliest || wakeAt < earliest)) earliest = wakeAt;
  }
  return earliest;
}

function normalizeWakeSettings(input: {
  mode: string;
  nightStart: string;
  nightEnd: string;
}): ProcessingWakeSettings {
  return {
    mode: input.mode === 'ALWAYS' || input.mode === 'MANUAL' ? input.mode : 'NIGHT',
    nightStart: input.nightStart,
    nightEnd: input.nightEnd,
  };
}

function defaultWakeSettings(): ProcessingWakeSettings {
  return {
    mode: 'NIGHT',
    nightStart: '23:00',
    nightEnd: '06:00',
  };
}

async function drainAndScheduleWork(): Promise<void> {
  if (stopping) return;
  await propagateFailedDependencies(prisma);
  await poll();
  if (!stopping && resourcePool.activeCount === 0) {
    wakeScheduler?.scheduleAt(await nextQueueWakeAt());
  }
}

async function processClaimedTagBuild(build: EagleTagSemanticBuild): Promise<void> {
  const renewal = setInterval(() => {
    void prisma.eagleTagSemanticBuild
      .updateMany({
        where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
        data: { lockedAt: new Date() },
      })
      .catch(reportLoopError);
  }, 60_000);
  renewal.unref();
  try {
    await processTagSemanticBuild(build, tagBuildContext);
    process.stdout.write(
      `${JSON.stringify({ event: 'eagle_tag_semantic_build_completed', buildId: build.id, tagId: build.tagId })}\n`,
    );
  } catch (error) {
    await failTagSemanticBuild(build, error, tagBuildContext);
    const message = error instanceof Error ? error.message : 'unknown tag semantic build error';
    process.stderr.write(`failed tag semantic build ${build.id}: ${message}\n`);
  } finally {
    clearInterval(renewal);
    activeTagBuildCount -= 1;
    wakeScheduler?.wakeNow();
  }
}

async function processClaimedJob(
  job: EagleAssetProcessingJob,
  remoteRequired = false,
): Promise<void> {
  const startedRss = process.memoryUsage().rss;
  const startedAt = Date.now();
  inFlightJobs.set(job.id, job);
  let leaseHeld = true;
  let renewing = false;
  const renewal = setInterval(() => {
    if (renewing || !leaseHeld) return;
    renewing = true;
    void prisma.eagleAssetProcessingJob
      .updateMany({
        where: mediaExecutionGuard(job),
        data: { lockedAt: new Date() },
      })
      .then(({ count }) => {
        leaseHeld = count === 1;
      })
      .catch(reportLoopError)
      .finally(() => {
        renewing = false;
      });
  }, 60_000);
  renewal.unref();
  try {
    await processJob(job, remoteRequired, mediaJobContext);
    process.stdout.write(
      `${JSON.stringify({
        event: 'eagle_media_job_completed',
        processorVersion: job.processorVersion,
        resource:
          job.kind === 'GENERATE_EMBEDDING'
            ? 'EMBEDDING'
            : remoteRequired
              ? 'REMOTE_MEDIA'
              : 'LOCAL',
        elapsedMs: Date.now() - startedAt,
        jobId: job.id,
        kind: job.kind,
        rssBeforeMiB: startedRss / 1024 / 1024,
        rssAfterMiB: process.memoryUsage().rss / 1024 / 1024,
        processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
      })}\n`,
    );
  } catch (error) {
    if (leaseHeld) await failJob(job, error, mediaJobContext);
    const message = error instanceof Error ? error.message : 'unknown media error';
    process.stderr.write(`failed media job ${job.id}: ${message}\n`);
  } finally {
    inFlightJobs.delete(job.id);
    clearInterval(renewal);
    wakeScheduler?.wakeNow();
  }
}

function assertOwnedKey(ownerId: string, key: string): void {
  if (!key.startsWith(`users/${ownerId}/`)) throw new Error('CROSS_OWNER_OBJECT_KEY');
}

function hasActiveWork(): boolean {
  return (
    resourcePool.activeCount > 0 ||
    activeTagBuildCount > 0 ||
    buildingSmartFolder ||
    buildingPhotoMap ||
    checkingHeartbeat ||
    Boolean(objectDeletionRunner?.active)
  );
}

/** Hand unfinished media jobs back to the queue instead of waiting for the 10-minute lease. */
async function releaseInFlightJobs(): Promise<void> {
  const jobs = [...inFlightJobs.values()];
  if (!jobs.length) return;
  await prisma.eagleAssetProcessingJob
    .updateMany({
      where: {
        OR: jobs.map(({ id, leaseVersion }) => ({ id, leaseVersion })),
        status: 'PROCESSING',
      },
      data: { status: 'PENDING', lockedAt: null, leaseVersion: { increment: 1 } },
    })
    .catch(reportLoopError);
  process.stderr.write(`released ${jobs.length} media jobs after the shutdown deadline\n`);
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  smartFolderRunner?.stop();
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  wakeScheduler?.stop();
  objectDeletionRunner?.stop();
  await wakeListener?.stop();
  process.stdout.write(`SekerEagle worker received ${signal}\n`);
  const deadline = Date.now() + STOP_GRACE_MS;
  let forced = false;
  while (hasActiveWork()) {
    if (Date.now() >= deadline) {
      forced = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (forced) await releaseInFlightJobs();
  stopFaceInference();
  await prisma.eagleProcessingWorkerHeartbeat.deleteMany({ where: { workerId } });
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 0;
  // Never let ffmpeg/sharp outlive the deployment grace period after jobs are released.
  if (forced) {
    process.stderr.write('worker forced exit after releasing in-flight media jobs\n');
    process.exit(0);
  }
}

async function main(): Promise<void> {
  await heartbeat();
  process.stdout.write(`SekerEagle worker ready: ${workerId}\n`);
  objectDeletionRunner = new ObjectDeletionRunner(
    prisma,
    {
      deleteObjects: async (keys) => {
        const result = await storage.send(
          new DeleteObjectsCommand({
            Bucket: s3Bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (result.Errors?.length) throw new Error('OBJECT_DELETION_INCOMPLETE');
      },
      deletePrefix: deleteOwnedPrefix,
    },
    reportLoopError,
  );
  wakeScheduler = new JobWakeScheduler(drainAndScheduleWork, reportLoopError);
  wakeListener = new PostgresWakeListener(
    databaseUrl,
    (payload) => {
      invalidateMediaCandidates(selectors, payload);
      wakeScheduler?.wakeNow();
    },
    reportLoopError,
    () => objectDeletionRunner?.wake(),
    (event) => {
      if (event.kinds.some((kind) => kind === 'MAP' || kind === 'FOLDERS' || kind === 'SETTINGS'))
        wakeScheduler?.wakeNow();
      if (
        event.kinds.some(
          (kind) => kind === 'FOLDERS' || kind === 'RECOMMENDATIONS' || kind === 'SETTINGS',
        )
      )
        smartFolderRunner?.wake();
    },
  );
  await wakeListener.start();
  heartbeatTimer = setInterval(() => void heartbeat().catch(reportLoopError), 15_000);
  // Semantic folders reuse saved vectors and request 2B only for uncached queries.
  if (
    runBackgroundProcessing &&
    (!allowedJobKinds || allowedJobKinds.includes('GENERATE_EMBEDDING'))
  ) {
    const tick = async (allowModelRequest: boolean) => {
      if (stopping || buildingSmartFolder || buildingPhotoMap) return;
      buildingSmartFolder = true;
      let continueImmediately = false;
      try {
        await reconcileSmartFolderSpaces(prisma, embeddingSpaceId);
        await runSmartFolderBuildStep(
          prisma,
          embeddingSpaceId,
          createCompatibleTextEmbedding(prisma, embeddingIdentity, (text) =>
            embeddingClient.embedText(text),
          ),
          allowModelRequest &&
            embeddingReadiness === 'READY' &&
            (embeddingClient.computeRuntime?.backgroundLimit ?? legacyEmbeddingLimit) > 0,
          () => {
            continueImmediately = true;
          },
        );
        return continueImmediately;
      } finally {
        buildingSmartFolder = false;
      }
    };
    smartFolderRunner = new SmartFolderBuildRunner(
      (run) => resourcePool.maintenance(run),
      tick,
      reportLoopError,
    );
    smartFolderRunner.wake();
  }
  wakeScheduler.wakeNow();
}

function reportLoopError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'unknown worker loop error';
  process.stderr.write(`${message}\n`);
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
void main().catch(async (error: unknown) => {
  reportLoopError(error);
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 1;
});
