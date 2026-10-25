import { mediaQueueAgeOrder } from './media-queue-policy';
import { MediaResourcePool, type MediaResource } from './media-resource-pool';
import { runPhotoMapBuildStep } from './photo-map-build';
import { reconcileSmartFolderSpaces, runSmartFolderBuildStep } from './smart-folder-build';
import { publishImage } from './image-publication';
import { publishEmbedding } from './embedding-publication';
import { buildMediaWakeQuery } from './job-wakeup-query';
import { processVideo } from './video-processing';
import {
  VIDEO_PLAYBACK_PROCESSOR_VERSION,
  videoTranscodingEnabled,
} from './video-processing-policy';
import { backgroundProcessingEnabled, mediaBackgroundAllowed } from './processing-policy';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import {
  renderImageRenditions,
  catalogImageDimensions,
  canReuseImageBrowsing,
} from './image-renditions';
import { claimNextScheduledTagBuild, holdTagBuildLease } from './tag-build-lease';
import { recordWorkerHeartbeat } from './worker-health';
import { ensureCompatibleEmbeddingSpace } from './embedding-space';
import { mediaLaneOrder, propagateFailedDependencies } from './job-recovery';
import { prepareAssetPurge, drainObjectDeletion } from './asset-purge';
import {
  nextBackgroundTime,
  CAMERA_MAX_IMAGE_BYTES,
  isCameraVideoMime,
  isCameraRawMime,
} from '@sekereagle/library-core';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Prisma,
  PrismaClient,
  type EagleAssetProcessingJob,
  type EagleTagSemanticBuild,
  type LibraryMode,
} from '@prisma/client';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from '@sekereagle/config';
import {
  parseProcessingJobKinds,
  taskBlocksAssetReady,
  terminalAssetFailure,
} from './processing-policy';
import { inferPhotoFaces, persistPhotoFaces } from './photo-faces';
import { inspectLivePhotoImage, inspectJpegLivePhoto, inspectLivePhotoStream } from './live-photo';
import { readOwnedImageRange } from './image-range';
import { analyzePhotoPixels, readPhotoExif } from './photo-analysis';
import { extractRepresentativeColors } from './color-palette';
import { selectImageJobSource } from './image-job-source';
import { withProcessableImage } from './image-media';
import { buildPyramidDescriptor, parseDeepZoomTilePath } from './image-pyramid';
import { createScheduledMediaSelector } from './scheduled-media-candidates';
import { taskPolicyAllowsSql } from '@sekereagle/library-persistence';
import { claimNextMediaJob } from './job-claim';
import {
  isPermanentMediaValidationError,
  PermanentMediaValidationError,
} from './media-validation-error';
import { EmbeddingClient, EmbeddingClientError } from './embedding-client';
import { buildPrototypePlan, parsePgVector } from './tag-semantic-build';
import {
  JobWakeScheduler,
  nextEligibleWakeAt,
  PostgresWakeListener,
  type ProcessingWakeSettings,
} from './job-wakeup';

const databaseUrl = process.env.DATABASE_URL ?? '';
const s3Endpoint = process.env.S3_ENDPOINT ?? '';
const s3Bucket = process.env.S3_BUCKET ?? '';
assertSafeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket });
process.stdout.write(
  `SekerEagle worker target: ${describeRuntimeTarget({ databaseUrl, s3Endpoint, s3Bucket })}\n`,
);

const workerId = `worker-${randomUUID()}`;
const workerVersion = 'v1';
const prisma = new PrismaClient();
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
let smartFolderTimer: NodeJS.Timeout | undefined;
let buildingSmartFolder = false;
let buildingPhotoMap = false;
let photoMapTimer: NodeJS.Timeout | undefined;
let lastPhotoMapStep = 0;
let stopping = false;
let activeTagBuildCount = 0;
let deletingObjects = false;
const runBackgroundProcessing = backgroundProcessingEnabled(
  process.env.EAGLE_BACKGROUND_PROCESSING_ENABLED,
);
const allowedJobKinds = parseProcessingJobKinds(process.env.EAGLE_PROCESSING_JOB_KINDS);
const runTagBuilds = runBackgroundProcessing && allowedJobKinds === undefined;
const runVideoTranscoding = videoTranscodingEnabled(process.env.EAGLE_VIDEO_TRANSCODING_ENABLED);
const configuredConcurrency = Number(process.env.EAGLE_INTERACTIVE_CONCURRENCY ?? '1');
const workerConcurrency = Number.isSafeInteger(configuredConcurrency)
  ? Math.min(4, Math.max(1, configuredConcurrency))
  : 1;
const resourcePool = new MediaResourcePool(
  workerConcurrency,
  () => wakeScheduler?.wakeNow(),
  reportLoopError,
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

async function heartbeat(): Promise<void> {
  if (checkingHeartbeat) return;
  checkingHeartbeat = true;
  try {
    const previousReadiness = embeddingReadiness;
    if (
      runBackgroundProcessing &&
      (!allowedJobKinds || allowedJobKinds.includes('GENERATE_EMBEDDING'))
    )
      embeddingReadiness = await embeddingClient.readiness();
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
    if (previousReadiness !== embeddingReadiness) wakeScheduler?.wakeNow();
  } finally {
    checkingHeartbeat = false;
  }
}

const selectors = {
  NAS: createScheduledMediaSelector(prisma, () => embeddingReadiness !== 'READY', 'NAS'),
  EMBEDDING: createScheduledMediaSelector(
    prisma,
    () => embeddingReadiness !== 'READY',
    'EMBEDDING',
  ),
};
const claimSequence: Record<MediaResource, number> = { NAS: 0, EMBEDDING: 0 };
async function claimJob(resource: MediaResource): Promise<EagleAssetProcessingJob | null> {
  if (
    stopping ||
    (resource === 'EMBEDDING' && (!runBackgroundProcessing || embeddingReadiness !== 'READY'))
  )
    return null;
  const sequence = claimSequence[resource]++;
  for (const age of mediaQueueAgeOrder(sequence)) {
    const job = await claimNextMediaJob(prisma, {
      selectCandidates: (input) => selectors[resource](input, age),
      canClaimBackground: canClaimBackgroundForOwner,
      allowedJobKinds,
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
  const settings = await prisma.eagleProcessingSetting.findUnique({
    where: { ownerId_libraryMode: { ownerId, libraryMode } },
  });
  return mediaBackgroundAllowed(settings, kind);
}

async function processJob(job: EagleAssetProcessingJob): Promise<void> {
  if (job.kind === 'PURGE_ASSET') {
    await purgeAsset(job);
    return;
  }
  const asset = await prisma.eagleAsset.findFirst({
    where: {
      id: job.assetId,
      ownerId: job.ownerId,
      libraryMode: job.libraryMode,
      mediaRevision: job.assetRevision,
      deletedAt: null,
    },
    include: {
      renditions: {
        where: {
          revision: job.assetRevision,
          kind: { in: ['THUMBNAIL', 'PREVIEW'] },
          status: 'READY',
        },
        select: {
          kind: true,
          variant: true,
          revision: true,
          status: true,
          storageKey: true,
          mimeType: true,
        },
      },
      uploadSessions: {
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { eagleState: { select: { expectedContentSha256: true } } },
      },
    },
  });
  if (!asset) {
    await prisma.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        lockedAt: null,
        lastError: 'ASSET_TRASHED',
      },
    });
    return;
  }
  if (job.kind === 'ANALYZE_PHOTO_FACES') {
    if (asset.libraryMode !== 'PHOTO') throw new Error('PHOTO_FACE_LIBRARY_MISMATCH');
    const preview = selectImageJobSource(asset, job.kind);
    assertOwnedKey(asset.ownerId, preview.storageKey);
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: preview.storageKey }),
    );
    if (!object.Body) throw new Error('PHOTO_FACE_PREVIEW_MISSING');
    const bytes = await readBoundedBytes(
      object.Body as AsyncIterable<Uint8Array>,
      20 * 1024 * 1024,
    );
    await persistPhotoFaces(prisma, job, await inferPhotoFaces(bytes));
    return;
  }

  if (asset.mimeType.startsWith('image/') && canReuseImageBrowsing(job, asset)) {
    await publishImage(prisma, {
      asset,
      job,
      renditions: [],
      sha256: asset.sha256!,
      dimensions: {},
      photoAnalysis: null,
      livePhoto: null,
      scheduleFaces: false,
      deferDetails: asset.libraryMode === 'PHOTO' || isCameraRawMime(asset.mimeType),
      preserveBrowseState: true,
    });
    return;
  }

  assertOwnedKey(asset.ownerId, asset.originalObjectKey);
  if (job.kind === 'EXTRACT_COLOR_PALETTE') {
    await prisma.eagleAssetColorAnalysis.upsert({
      where: {
        assetId_assetRevision_processorVersion: {
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          processorVersion: job.processorVersion,
        },
      },
      create: {
        ownerId: job.ownerId,
        libraryMode: job.libraryMode,
        assetId: job.assetId,
        assetRevision: job.assetRevision,
        processorVersion: job.processorVersion,
        status: 'RUNNING',
        startedAt: new Date(),
      },
      update: { status: 'RUNNING', startedAt: new Date(), completedAt: null, lastError: null },
    });
  }

  if (asset.mimeType.startsWith('image/')) {
    if (asset.byteSize > BigInt(CAMERA_MAX_IMAGE_BYTES))
      throw new PermanentMediaValidationError(
        'IMAGE_CONTENT_MISMATCH',
        'IMAGE_TOO_LARGE_TO_PROCESS',
      );
    const sourceDetailsOnly = job.processorVersion === 'photo-source-details-v1';
    const sourceDetails = selectImageJobSource(asset, job.kind, job.processorVersion);
    if (sourceDetailsOnly && !sourceDetails.verifiesOriginalHash && !asset.sha256)
      throw new Error('ORIGINAL_HASH_REQUIRED');
    process.stdout.write(
      `${JSON.stringify({
        event: 'eagle_media_source_selected',
        jobId: job.id,
        kind: job.kind,
        source: sourceDetails.verifiesOriginalHash
          ? 'ORIGINAL'
          : job.kind === 'EXTRACT_COLOR_PALETTE'
            ? 'THUMBNAIL'
            : 'PREVIEW',
      })}\n`,
    );
    assertOwnedKey(asset.ownerId, sourceDetails.storageKey);
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: sourceDetails.storageKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    if (job.kind === 'GENERATE_EMBEDDING') {
      await processEmbeddingJob(
        job,
        asset,
        sourceDetails.mimeType,
        object.Body as AsyncIterable<Uint8Array>,
      );
      return;
    }
    const deferDetails =
      !sourceDetailsOnly && (isCameraRawMime(asset.mimeType) || asset.libraryMode === 'PHOTO');
    if (job.kind === 'GENERATE_IMAGE_PYRAMID') {
      await generateImagePyramid(job, asset, object.Body as AsyncIterable<Uint8Array>);
      return;
    }
    const {
      result: processed,
      sha256,
      sourceMode,
    } = await withProcessableImage(
      object.Body as AsyncIterable<Uint8Array>,
      sourceDetails.mimeType,
      sourceDetails.storageKey,
      async (source, originalPath, originalDimensions) => {
        const metadataPromise = source.clone().metadata();
        if (job.kind === 'EXTRACT_COLOR_PALETTE') {
          const [{ data, info }, metadata] = await Promise.all([
            source
              .clone()
              .rotate()
              .toColourspace('srgb')
              .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true })
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true }),
            metadataPromise,
          ]);
          return {
            metadata,
            palette: extractRepresentativeColors(data, info.channels, info.width * info.height, 6),
            rendered: null,
          };
        }
        const metadata = await metadataPromise;
        const rendered = await renderImageRenditions(
          source,
          asset.mimeType,
          sourceDetailsOnly ? 'DETAILS' : 'BROWSE',
        );
        const photoAnalysis =
          asset.libraryMode === 'PHOTO'
            ? {
                ...(!sourceDetailsOnly ? await readPhotoExif(metadata.exif, originalPath) : {}),
                ...(sourceDetailsOnly
                  ? {
                      ...(await analyzePhotoPixels(source)),
                      ...(!sourceDetails.verifiesOriginalHash
                        ? { processorVersion: 'preview-laplacian-dhash-v3' }
                        : {}),
                    }
                  : {}),
              }
            : null;
        const livePhoto =
          originalPath && (sourceDetailsOnly || !deferDetails)
            ? await inspectLivePhotoImage(originalPath)
            : null;
        return { metadata, originalDimensions, palette: null, rendered, photoAnalysis, livePhoto };
      },
      sourceDetails.verifiesOriginalHash &&
        (taskBlocksAssetReady(job.kind, job.processorVersion) || sourceDetailsOnly),
      sourceDetailsOnly ? 'DEVELOP' : 'BROWSE',
    );
    process.stdout.write(
      `${JSON.stringify({ event: 'eagle_image_rendered', jobId: job.id, processorVersion: job.processorVersion, mimeType: asset.mimeType, sourceMode })}\n`,
    );
    if (sourceDetails.verifiesOriginalHash) {
      assertExpectedHash(
        asset.uploadSessions[0]?.eagleState?.expectedContentSha256 ?? asset.sha256,
        sha256,
      );
    }
    if (job.kind === 'EXTRACT_COLOR_PALETTE') {
      await prisma.$transaction(async (transaction) => {
        const completed = await transaction.eagleAssetProcessingJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
          data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
        });
        if (completed.count !== 1) return;
        await transaction.eagleAssetColorAnalysis.updateMany({
          where: {
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            assetId: asset.id,
            isCurrent: true,
          },
          data: { isCurrent: false },
        });
        const analysis = await transaction.eagleAssetColorAnalysis.upsert({
          where: {
            assetId_assetRevision_processorVersion: {
              assetId: asset.id,
              assetRevision: job.assetRevision,
              processorVersion: job.processorVersion,
            },
          },
          create: {
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            assetId: asset.id,
            assetRevision: job.assetRevision,
            processorVersion: job.processorVersion,
            status: 'COMPLETED',
            isCurrent: true,
            startedAt: job.startedAt ?? new Date(),
            completedAt: new Date(),
          },
          update: {
            status: 'COMPLETED',
            isCurrent: true,
            lastError: null,
            completedAt: new Date(),
          },
        });
        await transaction.eagleAssetColorSwatch.deleteMany({
          where: {
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            analysisId: analysis.id,
          },
        });
        if (processed.palette?.length) {
          await transaction.eagleAssetColorSwatch.createMany({
            data: processed.palette.map((swatch, rank) => ({
              ownerId: asset.ownerId,
              libraryMode: asset.libraryMode,
              analysisId: analysis.id,
              rank,
              ...swatch,
            })),
          });
        }
      });
      return;
    }
    const renditions: Prisma.EagleAssetRenditionUncheckedCreateInput[] = [];
    for (const { spec, output: rendered } of processed.rendered ?? []) {
      const storageKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/${spec.kind.toLowerCase()}-${spec.variant}.webp`;
      await storage.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: storageKey,
          Body: rendered.data,
          ContentType: 'image/webp',
        }),
      );
      renditions.push({
        ownerId: asset.ownerId,
        libraryMode: asset.libraryMode,
        assetId: asset.id,
        kind: spec.kind,
        variant: spec.variant,
        revision: job.assetRevision,
        storageKey,
        mimeType: 'image/webp',
        byteSize: BigInt(rendered.data.byteLength),
        width: rendered.info.width,
        height: rendered.info.height,
        status: 'READY' as const,
      });
    }
    let livePhoto = 'livePhoto' in processed ? processed.livePhoto : null;
    if (sourceDetailsOnly && !sourceDetails.verifiesOriginalHash) {
      if (asset.mimeType === 'image/jpeg') {
        livePhoto = await inspectJpegLivePhoto(Number(asset.byteSize), (start, length) =>
          readOwnedImageRange(
            (input) => storage.send(new GetObjectCommand(input)),
            {
              bucket: s3Bucket,
              ownerId: asset.ownerId,
              key: asset.originalObjectKey,
              byteSize: Number(asset.byteSize),
            },
            start,
            length,
          ),
        );
      } else if (asset.mimeType === 'image/heic' || asset.mimeType === 'image/heif') {
        const original = await storage.send(
          new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
        );
        if (!original.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
        livePhoto = await inspectLivePhotoStream(
          original.Body as AsyncIterable<Uint8Array>,
          asset.sha256!,
        );
      }
    }
    if (livePhoto?.motion) {
      const motionKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/motion.mp4`;
      await storage.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: motionKey,
          Body: livePhoto.motion.data,
          ContentType: 'video/mp4',
        }),
      );
      renditions.push({
        ownerId: asset.ownerId,
        libraryMode: asset.libraryMode,
        assetId: asset.id,
        kind: 'PREVIEW',
        variant: 'motion',
        revision: job.assetRevision,
        storageKey: motionKey,
        mimeType: 'video/mp4',
        byteSize: BigInt(livePhoto.motion.data.length),
        width: livePhoto.motion.width,
        height: livePhoto.motion.height,
        status: 'READY',
      });
    }
    await publishImage(prisma, {
      asset,
      job,
      renditions,
      sha256: sourceDetails.verifiesOriginalHash ? sha256 : asset.sha256!,
      dimensions: sourceDetailsOnly
        ? {}
        : catalogImageDimensions(
            processed.metadata,
            'originalDimensions' in processed ? processed.originalDimensions : undefined,
          ),
      photoAnalysis: 'photoAnalysis' in processed ? (processed.photoAnalysis ?? null) : null,
      livePhoto: livePhoto ?? null,
      scheduleFaces: Boolean(process.env.PHOTO_FACE_PYTHON && process.env.PHOTO_FACE_MODEL_DIR),
      deferDetails,
      preserveBrowseState: sourceDetailsOnly,
    });
    return;
  }

  if (!isCameraVideoMime(asset.mimeType))
    throw new PermanentMediaValidationError('UNSUPPORTED_MEDIA_TYPE');
  await processVideo(job, asset, {
    prisma,
    storage,
    s3Bucket,
    assertExpectedHash,
    transcodingEnabled: runVideoTranscoding,
    lockPrivacy: lockOwnerPrivacyProjection,
    syncPrivacy: syncAssetPrivacy,
  });
}

async function processEmbeddingJob(
  job: EagleAssetProcessingJob,
  asset: { id: string; ownerId: string; libraryMode: LibraryMode },
  mimeType: string,
  source: AsyncIterable<Uint8Array>,
): Promise<void> {
  if (!process.env.MLX_EMBEDDING_TOKEN?.trim()) throw new Error('MLX_EMBEDDING_TOKEN_REQUIRED');
  await prisma.eagleEmbeddingSpace.upsert({
    where: { id: embeddingSpaceId },
    create: {
      id: embeddingSpaceId,
      model: embeddingModel,
      revision: embeddingRevision,
      dimensions: embeddingDimensions,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
      normalized: true,
      isCurrent: true,
    },
    update: {
      model: embeddingModel,
      revision: embeddingRevision,
      dimensions: embeddingDimensions,
      instructionVersion: 'image-retrieval-v1',
      preprocessingVersion: 'preview-webp-v1',
      normalized: true,
      isCurrent: true,
    },
  });
  const record = await prisma.eagleAssetEmbedding.upsert({
    where: {
      assetId_assetRevision_spaceId: {
        assetId: asset.id,
        assetRevision: job.assetRevision,
        spaceId: embeddingSpaceId,
      },
    },
    create: {
      ownerId: asset.ownerId,
      libraryMode: asset.libraryMode,
      assetId: asset.id,
      assetRevision: job.assetRevision,
      spaceId: embeddingSpaceId,
      status: 'RUNNING',
      startedAt: new Date(),
    },
    update: {
      status: 'RUNNING',
      errorCode: null,
      startedAt: new Date(),
      completedAt: null,
    },
    select: { id: true },
  });
  const bytes = await readBoundedBytes(source, 20 * 1024 * 1024);
  const { embedding } = await embeddingClient.embedImage(bytes, mimeType);
  await publishEmbedding(prisma, job, record.id, embedding, createTopSuggestion);
}

async function createTopSuggestion(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  assetId: string,
  embeddingId: string,
): Promise<void> {
  const minimumScore = boundedNumber(process.env.EAGLE_VECTOR_MINIMUM_SCORE, 0.3, -1, 1);
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleVectorTagSuggestion" (
        "id", "ownerId", "libraryMode", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", "score", "distance", "prototypeRank", "status", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, ${ownerId}, ${libraryMode}::"LibraryMode", ${assetId}, candidate."tagId", ${embeddingId},
             candidate."snapshotId", candidate."generationId", true, 1 - candidate.distance,
             candidate.distance, candidate.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM (
        SELECT snapshot."tagId", prototype."snapshotId", snapshot."generationId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleAssetEmbedding" embedding
        JOIN "EagleTagPrototype" prototype ON prototype."ownerId" = embedding."ownerId" AND prototype."libraryMode" = embedding."libraryMode"
        JOIN "EagleTagPrototypeSnapshot" snapshot
          ON snapshot."ownerId" = prototype."ownerId" AND snapshot."libraryMode" = prototype."libraryMode" AND snapshot.id = prototype."snapshotId"
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."libraryMode" = snapshot."libraryMode" AND config."tagId" = snapshot."tagId"
        WHERE embedding."ownerId" = ${ownerId} AND embedding."libraryMode" = ${libraryMode}::"LibraryMode" AND embedding.id = ${embeddingId}
          AND snapshot."spaceId" = embedding."spaceId"
          AND snapshot."isCurrent" = true AND snapshot.status = 'ACTIVE'
          AND config."recommendationEnabled" = true
        ORDER BY prototype.embedding <=> embedding.embedding ASC
        LIMIT 1
      ) candidate
      WHERE 1 - candidate.distance >= ${minimumScore}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = ${ownerId} AND manual."libraryMode" = ${libraryMode}::"LibraryMode" AND manual."assetId" = ${assetId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "EagleVectorTagSuggestion" existing
          WHERE existing."ownerId" = ${ownerId} AND existing."libraryMode" = ${libraryMode}::"LibraryMode" AND existing."assetId" = ${assetId}
            AND existing."isActive" = true AND existing.status = 'PENDING' AND existing."invalidatedAt" IS NULL
        )
    `,
  );
}

async function readBoundedBytes(
  source: AsyncIterable<Uint8Array>,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.byteLength;
    if (size > maximumBytes) throw new Error('EMBEDDING_PREVIEW_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

async function processTagSemanticBuild(build: EagleTagSemanticBuild): Promise<void> {
  if (build.operation === 'RECOMPUTE_SUGGESTIONS') {
    await recomputeSuggestionGeneration(build, null);
    return;
  }
  const [config, space, currentSnapshot, memberStats] = await Promise.all([
    prisma.eagleManualTagSemanticConfig.findUnique({
      where: { ownerId_tagId: { ownerId: build.ownerId, tagId: build.tagId } },
    }),
    prisma.eagleEmbeddingSpace.findFirst({ where: { isCurrent: true } }),
    prisma.eagleTagPrototypeSnapshot.findFirst({
      where: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        tagId: build.tagId,
        isCurrent: true,
      },
      select: { id: true, version: true, sourceAssetCount: true },
    }),
    prisma.$queryRaw<Array<{ count: bigint; digest: string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count,
             md5(string_agg(link."assetId", ',' ORDER BY link."assetId")) AS digest
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
       AND embedding."assetRevision" = asset."mediaRevision" AND embedding."spaceId" = ${embeddingSpaceId}
      WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
        AND asset."deletedAt" IS NULL
    `),
  ]);
  if (!config?.recommendationEnabled) throw new Error('TAG_RECOMMENDATION_DISABLED');
  if (!space) throw new Error('CURRENT_EMBEDDING_SPACE_MISSING');
  const memberCount = Number(memberStats[0]?.count ?? 0n);
  if (!memberCount) throw new Error('TAG_HAS_NO_READY_EMBEDDINGS');
  const sampleLimit = boundedInteger(process.env.EAGLE_TAG_CLUSTER_SAMPLE_SIZE, 2_000, 1, 10_000);
  const sample = await prisma.$queryRaw<Array<{ assetId: string; embedding: string }>>(Prisma.sql`
    SELECT link."assetId", embedding.embedding::text AS embedding
    FROM "EagleAssetManualTag" link
    JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
    JOIN "EagleAssetEmbedding" embedding
      ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
     AND embedding."isCurrent" = true AND embedding.status = 'READY'
     AND embedding."assetRevision" = asset."mediaRevision" AND embedding."spaceId" = ${embeddingSpaceId}
    WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
      AND asset."deletedAt" IS NULL
    ORDER BY md5(link."assetId")
    LIMIT ${sampleLimit}
  `);
  const prototypePlan = buildPrototypePlan(
    sample.map((row) => ({
      assetId: row.assetId,
      embedding: parsePgVector(row.embedding, embeddingDimensions),
    })),
    {
      maxK: boundedInteger(process.env.EAGLE_TAG_MAX_CENTERS, 8, 1, 8),
      minimumRelativeImprovement: boundedNumber(
        process.env.EAGLE_TAG_CENTER_MINIMUM_IMPROVEMENT,
        0.12,
        0,
        1,
      ),
    },
  );
  const generationId = randomUUID();
  const snapshot = await prisma.$transaction(async (transaction) => {
    await holdTagBuildLease(transaction, build);
    const versions = await transaction.eagleTagPrototypeSnapshot.aggregate({
      where: { ownerId: build.ownerId, libraryMode: build.libraryMode, tagId: build.tagId },
      _max: { version: true },
    });
    const row = await transaction.eagleTagPrototypeSnapshot.create({
      data: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        tagId: build.tagId,
        spaceId: space.id,
        version: (versions._max.version ?? 0) + 1,
        generationId,
        status: 'BUILDING',
        sourceAssetCount: memberCount,
        sourceSetDigest: memberStats[0]?.digest ?? createHash('sha256').update('').digest('hex'),
        algorithm: 'MINIBATCH_SPHERICAL_KMEANS',
        algorithmVersion: 'v1',
        algorithmParams: {
          maxK: 8,
          minimumRelativeImprovement: 0.12,
          batchSize: 128,
          outlierTrimFraction: 0.02,
          sampleLimit,
          sampleCount: sample.length,
        },
        addedMemberCount: Math.max(0, memberCount - (currentSnapshot?.sourceAssetCount ?? 0)),
        removedMemberCount: Math.max(0, (currentSnapshot?.sourceAssetCount ?? 0) - memberCount),
      },
    });
    await transaction.eagleTagSemanticBuild.update({
      where: { id: build.id },
      data: { candidateSnapshotId: row.id },
    });
    return row;
  });
  for (const prototype of prototypePlan.prototypes) {
    const vector = `[${prototype.embedding.join(',')}]`;
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "EagleTagPrototype" (
          "ownerId", "libraryMode", "snapshotId", rank, embedding, "memberCount", weight,
          "meanDistance", "p95Distance", "representativeAssetIds", "createdAt"
        ) VALUES (
          ${build.ownerId}, ${build.libraryMode}::"LibraryMode", ${snapshot.id}, ${prototype.rank}, ${vector}::vector,
          ${prototype.memberCount}, ${prototype.weight}, ${prototype.meanDistance},
          ${prototype.p95Distance}, ${prototype.representativeAssetIds}, NOW()
        )
      `,
    );
  }
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleTagMemberDistance" (
        "ownerId", "libraryMode", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
      )
      SELECT link."ownerId", link."libraryMode", link."tagId", link."assetId", ${snapshot.id}, nearest.distance,
             nearest.rank, NOW()
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset."libraryMode" = link."libraryMode" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."libraryMode" = link."libraryMode" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
       AND embedding."assetRevision"=asset."mediaRevision" AND embedding."spaceId"=${embeddingSpaceId}
      CROSS JOIN LATERAL (
        SELECT prototype.rank, prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototype" prototype
        WHERE prototype."ownerId" = ${build.ownerId} AND prototype."libraryMode" = ${build.libraryMode}::"LibraryMode" AND prototype."snapshotId" = ${snapshot.id}
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE link."ownerId" = ${build.ownerId} AND link."libraryMode" = ${build.libraryMode}::"LibraryMode" AND link."tagId" = ${build.tagId}
        AND asset."deletedAt" IS NULL
    `,
  );
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "EagleTagPrototype" prototype
      SET "memberCount" = statistics."memberCount",
          weight = statistics."memberCount"::double precision / ${memberCount},
          "meanDistance" = statistics."meanDistance",
          "p95Distance" = statistics."p95Distance"
      FROM (
        SELECT distance."prototypeRank" AS rank,
               COUNT(*)::integer AS "memberCount",
               AVG(distance.distance)::double precision AS "meanDistance",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY distance.distance)::double precision
                 AS "p95Distance"
        FROM "EagleTagMemberDistance" distance
        WHERE distance."ownerId" = ${build.ownerId} AND distance."libraryMode" = ${build.libraryMode}::"LibraryMode" AND distance."snapshotId" = ${snapshot.id}
        GROUP BY distance."prototypeRank"
      ) statistics
      WHERE prototype."ownerId" = ${build.ownerId} AND prototype."libraryMode" = ${build.libraryMode}::"LibraryMode"
        AND prototype."snapshotId" = ${snapshot.id}
        AND prototype.rank = statistics.rank
    `,
  );
  await recomputeSuggestionGeneration(build, snapshot.id);
}

async function recomputeSuggestionGeneration(
  build: EagleTagSemanticBuild,
  candidateSnapshotId: string | null,
): Promise<void> {
  const generationId = randomUUID();
  const minimumScore = boundedNumber(process.env.EAGLE_VECTOR_MINIMUM_SCORE, 0.3, -1, 1);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleVectorTagSuggestion" (
        "id", "ownerId", "libraryMode", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", score, distance, "prototypeRank", status, "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, embedding."ownerId", embedding."libraryMode", embedding."assetId", nearest."tagId",
             embedding.id, nearest."snapshotId", ${generationId}, false, 1 - nearest.distance,
             nearest.distance, nearest.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM "EagleAssetEmbedding" embedding
      JOIN "EagleAsset" asset ON asset."ownerId" = embedding."ownerId" AND asset."libraryMode" = embedding."libraryMode" AND asset.id = embedding."assetId"
      CROSS JOIN LATERAL (
        SELECT snapshot."tagId", snapshot.id AS "snapshotId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototypeSnapshot" snapshot
        JOIN "EagleTagPrototype" prototype
          ON prototype."ownerId" = snapshot."ownerId" AND prototype."libraryMode" = snapshot."libraryMode" AND prototype."snapshotId" = snapshot.id
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."libraryMode" = snapshot."libraryMode" AND config."tagId" = snapshot."tagId"
        WHERE snapshot."ownerId" = embedding."ownerId" AND snapshot."libraryMode" = embedding."libraryMode"
          AND snapshot."spaceId" = embedding."spaceId"
          AND config."recommendationEnabled" = true
          AND (snapshot.status = 'ACTIVE' OR snapshot.id = ${candidateSnapshotId})
          AND (
            (${candidateSnapshotId}::text IS NOT NULL AND snapshot.id = ${candidateSnapshotId})
            OR (snapshot."isCurrent" = true AND snapshot."tagId" <> ${build.tagId})
            OR (${candidateSnapshotId}::text IS NULL AND snapshot."isCurrent" = true)
          )
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE embedding."ownerId" = ${build.ownerId} AND embedding."libraryMode" = ${build.libraryMode}::"LibraryMode" AND embedding."isCurrent" = true
        AND embedding.status = 'READY' AND embedding."assetRevision" = asset."mediaRevision"
        AND embedding."spaceId" = ${embeddingSpaceId} AND asset."deletedAt" IS NULL
        AND 1 - nearest.distance >= ${minimumScore}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = embedding."ownerId" AND manual."libraryMode" = embedding."libraryMode" AND manual."assetId" = embedding."assetId"
        )
    `,
  );
  await prisma.$transaction(async (transaction) => {
    await holdTagBuildLease(transaction, build);
    await transaction.eagleVectorTagSuggestion.updateMany({
      where: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        isActive: true,
        status: 'PENDING',
        invalidatedAt: null,
      },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        invalidReason: 'PROTOTYPE_GENERATION_REPLACED',
      },
    });
    if (candidateSnapshotId) {
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: {
          ownerId: build.ownerId,
          libraryMode: build.libraryMode,
          tagId: build.tagId,
          isCurrent: true,
        },
        data: { isCurrent: false, status: 'SUPERSEDED' },
      });
      await transaction.eagleTagPrototypeSnapshot.update({
        where: { id: candidateSnapshotId },
        data: { isCurrent: true, status: 'ACTIVE', activatedAt: new Date() },
      });
      await transaction.eagleManualTagSemanticConfig.update({
        where: { ownerId_tagId: { ownerId: build.ownerId, tagId: build.tagId } },
        data: { currentSnapshotId: candidateSnapshotId, lastGeneratedAt: new Date() },
      });
    }
    await transaction.eagleVectorTagSuggestion.updateMany({
      where: {
        ownerId: build.ownerId,
        libraryMode: build.libraryMode,
        generationId,
        status: 'PENDING',
        invalidatedAt: null,
      },
      data: { isActive: true },
    });
    await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
  });
}

async function failTagSemanticBuild(build: EagleTagSemanticBuild, error: unknown): Promise<void> {
  if (error instanceof EmbeddingClientError && error.code === 'HOST_UNAVAILABLE') {
    embeddingReadiness = 'OFFLINE';
    await prisma.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: {
        status: 'PENDING',
        attempts: Math.max(0, build.attempts - 1),
        availableAt: new Date(Date.now() + 30000),
        lockedAt: null,
        lastError: 'WAITING_EMBEDDING_HOST',
      },
    });
    return;
  }

  const message = error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_TAG_BUILD_ERROR';
  const terminal = build.attempts >= 5 || message === 'TAG_RECOMMENDATION_DISABLED';
  const delaySeconds = Math.min(3_600, 2 ** Math.min(build.attempts, 12));
  await prisma.$transaction(async (transaction) => {
    const held = await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: terminal
        ? { status: 'FAILED', completedAt: new Date(), lockedAt: null, lastError: message }
        : {
            status: 'PENDING',
            availableAt: new Date(Date.now() + delaySeconds * 1_000),
            lockedAt: null,
            lastError: message,
          },
    });
    if (held.count !== 1) return;
    const persistedBuild = terminal
      ? await transaction.eagleTagSemanticBuild.findUnique({
          where: { id: build.id },
          select: { candidateSnapshotId: true },
        })
      : null;
    if (terminal && persistedBuild?.candidateSnapshotId) {
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: {
          ownerId: build.ownerId,
          libraryMode: build.libraryMode,
          id: persistedBuild.candidateSnapshotId,
          status: 'BUILDING',
        },
        data: { status: 'FAILED', failureCode: message.slice(0, 100) },
      });
    }
  });
}

async function generateImagePyramid(
  job: EagleAssetProcessingJob,
  asset: {
    id: string;
    ownerId: string;
    libraryMode: LibraryMode;
    mimeType: string;
    originalObjectKey: string;
    uploadSessions: Array<{ eagleState: { expectedContentSha256: string | null } | null }>;
  },
  sourceBody: AsyncIterable<Uint8Array>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-pyramid-'));
  const outputBase = join(directory, 'pyramid');
  const tileDirectory = `${outputBase}_files`;
  const storagePrefix = `users/${asset.ownerId}/assets/${asset.id}/pyramids/${job.assetRevision}/${job.processorVersion}`;
  assertOwnedKey(asset.ownerId, `${storagePrefix}/0/0_0.webp`);
  try {
    const { result, sha256 } = await withProcessableImage(
      sourceBody,
      asset.mimeType,
      asset.originalObjectKey,
      async (image) => {
        const metadata = await image.clone().metadata();
        const width = metadata.autoOrient.width ?? metadata.width;
        const height = metadata.autoOrient.height ?? metadata.height;
        if (!width || !height) throw new Error('INVALID_PYRAMID_DIMENSIONS');
        const descriptor = buildPyramidDescriptor(width, height);
        await prisma.eagleImagePyramid.upsert({
          where: {
            assetId_revision_processorVersion: {
              assetId: asset.id,
              revision: job.assetRevision,
              processorVersion: job.processorVersion,
            },
          },
          create: {
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            assetId: asset.id,
            revision: job.assetRevision,
            processorVersion: job.processorVersion,
            status: 'RUNNING',
            storagePrefix,
            ...descriptor,
          },
          update: { status: 'RUNNING', storagePrefix, lastError: null, ...descriptor },
        });
        await image
          .rotate()
          .webp({ quality: 82 })
          .tile({
            layout: 'dz',
            size: descriptor.tileSize,
            overlap: descriptor.overlap,
          })
          .toFile(`${outputBase}.dz`);
        return descriptor;
      },
    );
    assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);

    const tilePaths = await listFiles(tileDirectory);
    let byteSize = 0n;
    for (const filePath of tilePaths) {
      const relativePath = filePath.slice(tileDirectory.length + 1);
      const tile = parseDeepZoomTilePath(relativePath);
      const details = await stat(filePath);
      byteSize += BigInt(details.size);
      await storage.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: `${storagePrefix}/${tile.relativeKey}`,
          Body: await readFile(filePath),
          ContentType: 'image/webp',
        }),
      );
    }

    await prisma.$transaction(async (transaction) => {
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
        data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (completed.count !== 1) return;
      await transaction.eagleImagePyramid.update({
        where: {
          assetId_revision_processorVersion: {
            assetId: asset.id,
            revision: job.assetRevision,
            processorVersion: job.processorVersion,
          },
        },
        data: {
          status: 'READY',
          tileCount: tilePaths.length,
          byteSize,
          completedAt: new Date(),
          lastError: null,
          ...result,
        },
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.webp')) files.push(path);
  }
  return files.sort();
}

async function purgeAsset(job: EagleAssetProcessingJob): Promise<void> {
  await prisma.$transaction((transaction) => prepareAssetPurge(transaction, job));
}

async function failJob(job: EagleAssetProcessingJob, error: unknown): Promise<void> {
  if (error instanceof EmbeddingClientError && error.code === 'HOST_UNAVAILABLE') {
    embeddingReadiness = 'OFFLINE';
    await prisma.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: {
        status: 'PENDING',
        attempts: Math.max(0, job.attempts - 1),
        availableAt: new Date(Date.now() + 30000),
        lockedAt: null,
        lastError: 'WAITING_EMBEDDING_HOST',
      },
    });
    return;
  }

  const message =
    error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_PROCESSING_ERROR';
  const terminal = isPermanentMediaValidationError(error) || job.attempts >= 12;
  const delaySeconds = Math.min(3_600, 2 ** Math.min(job.attempts, 12));
  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: terminal
        ? { status: 'FAILED', completedAt: new Date(), lockedAt: null, lastError: message }
        : {
            status: 'PENDING',
            availableAt: new Date(Date.now() + delaySeconds * 1_000),
            lockedAt: null,
            lastError: message,
          },
    });
    if (failed.count !== 1) return;
    if (terminal) await propagateFailedDependencies(transaction);
    if (job.kind === 'EXTRACT_COLOR_PALETTE') {
      await transaction.eagleAssetColorAnalysis.upsert({
        where: {
          assetId_assetRevision_processorVersion: {
            assetId: job.assetId,
            assetRevision: job.assetRevision,
            processorVersion: job.processorVersion,
          },
        },
        create: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          processorVersion: job.processorVersion,
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
        update: {
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
      });
    }
    if (job.kind === 'GENERATE_IMAGE_PYRAMID') {
      await transaction.eagleImagePyramid.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          revision: job.assetRevision,
          processorVersion: job.processorVersion,
        },
        data: {
          status: terminal ? 'FAILED' : 'PENDING',
          lastError: message,
          completedAt: terminal ? new Date() : null,
        },
      });
    }
    if (job.kind === 'GENERATE_EMBEDDING') {
      await transaction.eagleAssetEmbedding.updateMany({
        where: {
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          spaceId: embeddingSpaceId,
        },
        data: {
          status: 'FAILED',
          errorCode: message.slice(0, 100),
          completedAt: new Date(),
        },
      });
    }
    const assetFailure = terminal
      ? terminalAssetFailure(job.kind, job.processorVersion, message)
      : null;
    if (assetFailure) {
      await transaction.eagleAsset.updateMany({
        where: {
          id: job.assetId,
          ownerId: job.ownerId,
          libraryMode: job.libraryMode,
          mediaRevision: job.assetRevision,
          ...(assetFailure.lifecycleStatus ? {} : { lifecycleStatus: { not: 'FAILED' as const } }),
        },
        data: assetFailure,
      });
    }
  });
}

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

async function poll(): Promise<void> {
  if (!stopping && !deletingObjects) {
    deletingObjects = true;
    void drainObjectDeletion(prisma, {
      deleteObject: async (key) => {
        await storage.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
      },
      deletePrefix: deleteOwnedPrefix,
    })
      .catch(reportLoopError)
      .finally(() => {
        deletingObjects = false;
      });
  }
  if (!stopping && runTagBuilds && activeTagBuildCount === 0) {
    const build = await claimNextScheduledTagBuild(prisma);
    if (build) {
      activeTagBuildCount++;
      void processClaimedTagBuild(build).catch(reportLoopError);
    }
  }
  if (stopping) return;
  await resourcePool.fill('EMBEDDING', () => claimJob('EMBEDDING'), processClaimedJob);
  if (resourcePool.active('NAS') >= workerConcurrency) return;
  if (
    runBackgroundProcessing &&
    resourcePool.active('NAS') === 0 &&
    activeTagBuildCount === 0 &&
    !buildingSmartFolder &&
    !buildingPhotoMap &&
    Date.now() - lastPhotoMapStep >= 15000
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

  await resourcePool.fill('NAS', () => claimJob('NAS'), processClaimedJob);
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
      (candidate.lane === 'BACKGROUND' || candidate.processorVersion === 'photo-source-details-v1')
    )
      continue;
    const wakeAt = nextEligibleWakeAt(
      {
        ...candidate,
        lane:
          candidate.processorVersion === 'photo-source-details-v1' ? 'BACKGROUND' : candidate.lane,
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
    await processTagSemanticBuild(build);
    process.stdout.write(
      `${JSON.stringify({ event: 'eagle_tag_semantic_build_completed', buildId: build.id, tagId: build.tagId })}\n`,
    );
  } catch (error) {
    await failTagSemanticBuild(build, error);
    const message = error instanceof Error ? error.message : 'unknown tag semantic build error';
    process.stderr.write(`failed tag semantic build ${build.id}: ${message}\n`);
  } finally {
    clearInterval(renewal);
    activeTagBuildCount -= 1;
    wakeScheduler?.wakeNow();
  }
}

async function processClaimedJob(job: EagleAssetProcessingJob): Promise<void> {
  const startedRss = process.memoryUsage().rss;
  const startedAt = Date.now();
  let leaseHeld = true;
  let renewing = false;
  const renewal = setInterval(() => {
    if (renewing || !leaseHeld) return;
    renewing = true;
    void prisma.eagleAssetProcessingJob
      .updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
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
    await processJob(job);
    process.stdout.write(
      `${JSON.stringify({
        event: 'eagle_media_job_completed',
        resource: job.kind === 'GENERATE_EMBEDDING' ? 'EMBEDDING' : 'NAS',
        elapsedMs: Date.now() - startedAt,
        jobId: job.id,
        kind: job.kind,
        rssBeforeMiB: startedRss / 1024 / 1024,
        rssAfterMiB: process.memoryUsage().rss / 1024 / 1024,
        processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
      })}\n`,
    );
  } catch (error) {
    if (leaseHeld) await failJob(job, error);
    const message = error instanceof Error ? error.message : 'unknown media error';
    process.stderr.write(`failed media job ${job.id}: ${message}\n`);
  } finally {
    clearInterval(renewal);
    wakeScheduler?.wakeNow();
  }
}

function assertOwnedKey(ownerId: string, key: string): void {
  if (!key.startsWith(`users/${ownerId}/`)) throw new Error('CROSS_OWNER_OBJECT_KEY');
}

function assertExpectedHash(expected: string | null | undefined, actual: string): void {
  if (expected && expected !== actual)
    throw new PermanentMediaValidationError('CONTENT_SHA256_MISMATCH');
}

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  if (smartFolderTimer) clearInterval(smartFolderTimer);
  if (photoMapTimer) clearInterval(photoMapTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  wakeScheduler?.stop();
  await wakeListener?.stop();
  process.stdout.write(`SekerEagle worker received ${signal}\n`);
  while (
    resourcePool.activeCount > 0 ||
    activeTagBuildCount > 0 ||
    buildingSmartFolder ||
    buildingPhotoMap ||
    checkingHeartbeat ||
    deletingObjects
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  await prisma.eagleProcessingWorkerHeartbeat.deleteMany({ where: { workerId } });
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 0;
}

async function main(): Promise<void> {
  await heartbeat();
  process.stdout.write(`SekerEagle worker ready: ${workerId}\n`);
  wakeScheduler = new JobWakeScheduler(drainAndScheduleWork, reportLoopError);
  wakeListener = new PostgresWakeListener(
    databaseUrl,
    () => wakeScheduler?.wakeNow(),
    reportLoopError,
  );
  await wakeListener.start();
  heartbeatTimer = setInterval(() => void heartbeat().catch(reportLoopError), 15_000);
  // Semantic folders reuse saved vectors and request 2B only for uncached queries.
  if (
    runBackgroundProcessing &&
    (!allowedJobKinds || allowedJobKinds.includes('GENERATE_EMBEDDING'))
  ) {
    const tick = async () => {
      if (stopping || buildingSmartFolder || buildingPhotoMap) return;
      buildingSmartFolder = true;
      try {
        await reconcileSmartFolderSpaces(prisma, embeddingSpaceId);
        await runSmartFolderBuildStep(
          prisma,
          embeddingSpaceId,
          async (text) => {
            await prisma.$transaction((tx) =>
              ensureCompatibleEmbeddingSpace(tx, {
                id: embeddingSpaceId,
                model: embeddingModel,
                revision: embeddingRevision,
                dimensions: embeddingDimensions,
                normalized: true,
                instructionVersion: 'image-retrieval-v1',
                preprocessingVersion: 'preview-webp-v1',
              }),
            );
            return embeddingClient.embedText(text);
          },
          embeddingReadiness === 'READY',
        );
      } finally {
        buildingSmartFolder = false;
      }
    };
    const queueFolderStep = () => {
      if (stopping || resourcePool.active('EMBEDDING')) return;
      void resourcePool
        .fill(
          'EMBEDDING',
          () => Promise.resolve(stopping ? null : true),
          async () => tick(),
        )
        .catch(reportLoopError);
    };
    smartFolderTimer = setInterval(queueFolderStep, 5_000);
    smartFolderTimer.unref();
    queueFolderStep();
  }
  if (runBackgroundProcessing) {
    photoMapTimer = setInterval(() => wakeScheduler?.wakeNow(), 15000);
    photoMapTimer.unref();
  }
  wakeScheduler.wakeNow();
}

function reportLoopError(error: unknown): void {
  const message = error instanceof Error ? error.message : 'unknown worker loop error';
  process.stderr.write(`${message}\n`);
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
void main().catch(async (error: unknown) => {
  reportLoopError(error);
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 1;
});
