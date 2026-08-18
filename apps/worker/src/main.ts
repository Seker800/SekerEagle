import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
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
} from '@prisma/client';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from '@sekereagle/config';
import { canClaimBackgroundJobs, taskBlocksAssetReady } from './processing-policy';
import { extractRepresentativeColors } from './color-palette';
import { selectImageJobSource } from './image-job-source';
import { withProcessableImage } from './image-media';
import { buildPyramidDescriptor, parseDeepZoomTilePath } from './image-pyramid';
import { parseBrowserCompatibleMp4Probe } from './media-video-policy';
import { claimNextMediaJob } from './job-claim';
import {
  isPermanentMediaValidationError,
  PermanentMediaValidationError,
} from './media-validation-error';
import { EmbeddingClient } from './embedding-client';
import { buildPrototypePlan, parsePgVector } from './tag-semantic-build';

const execFileAsync = promisify(execFile);

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
let pollTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let stopping = false;
let activeJobCount = 0;
const configuredConcurrency = Number(process.env.EAGLE_INTERACTIVE_CONCURRENCY ?? '1');
const workerConcurrency = Number.isSafeInteger(configuredConcurrency)
  ? Math.min(4, Math.max(1, configuredConcurrency))
  : 1;
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
  const now = new Date();
  await prisma.eagleProcessingWorkerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, version: workerVersion, startedAt: now, heartbeatAt: now, activeJobCount },
    update: { heartbeatAt: now, activeJobCount },
  });
}

async function claimJob(): Promise<EagleAssetProcessingJob | null> {
  return claimNextMediaJob(prisma, {
    canClaimBackground: canClaimBackgroundForOwner,
  });
}

async function claimTagBuild(): Promise<EagleTagSemanticBuild | null> {
  return prisma.$transaction(async (transaction) => {
    const candidate = await transaction.eagleTagSemanticBuild.findFirst({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!candidate) return null;
    const claimed = await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: candidate.id, status: 'PENDING', leaseVersion: candidate.leaseVersion },
      data: {
        status: 'PROCESSING',
        attempts: { increment: 1 },
        leaseVersion: { increment: 1 },
        lockedAt: new Date(),
        startedAt: candidate.startedAt ?? new Date(),
        lastError: null,
      },
    });
    if (claimed.count !== 1) return null;
    return transaction.eagleTagSemanticBuild.findUnique({ where: { id: candidate.id } });
  });
}

async function canClaimBackgroundForOwner(ownerId: string): Promise<boolean> {
  const settings = await prisma.eagleProcessingSetting.findUnique({ where: { ownerId } });
  const configuredMode = settings?.mode;
  const mode =
    configuredMode === 'ALWAYS' || configuredMode === 'MANUAL' || configuredMode === 'NIGHT'
      ? configuredMode
      : 'NIGHT';
  return canClaimBackgroundJobs(
    mode,
    settings?.nightStart ?? '23:00',
    settings?.nightEnd ?? '06:00',
  );
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
        select: { kind: true, revision: true, status: true, storageKey: true, mimeType: true },
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
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
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
    if (asset.byteSize > 250n * 1024n * 1024n)
      throw new PermanentMediaValidationError(
        'IMAGE_CONTENT_MISMATCH',
        'IMAGE_TOO_LARGE_TO_PROCESS',
      );
    const sourceDetails = selectImageJobSource(asset, job.kind);
    process.stdout.write(
      `${JSON.stringify({
        event: 'eagle_media_source_selected',
        jobId: job.id,
        kind: job.kind,
        source: sourceDetails.verifiesOriginalHash ? 'ORIGINAL' : 'THUMBNAIL',
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
    const renditionSpecs = [
      { kind: 'PREVIEW' as const, variant: 'default', maxSize: 1600 },
      { kind: 'THUMBNAIL' as const, variant: '256', maxSize: 256 },
      { kind: 'THUMBNAIL' as const, variant: '512', maxSize: 512 },
    ];
    if (job.kind === 'GENERATE_IMAGE_PYRAMID') {
      await generateImagePyramid(job, asset, object.Body as AsyncIterable<Uint8Array>);
      return;
    }
    const { result: processed, sha256 } = await withProcessableImage(
      object.Body as AsyncIterable<Uint8Array>,
      sourceDetails.mimeType,
      sourceDetails.storageKey,
      async (source) => {
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
        const rendered = [];
        for (const spec of renditionSpecs) {
          rendered.push({
            spec,
            output: await source
              .clone()
              .rotate()
              .resize({
                width: spec.maxSize,
                height: spec.maxSize,
                fit: 'inside',
                withoutEnlargement: true,
              })
              .webp({ quality: spec.kind === 'THUMBNAIL' ? 78 : 86 })
              .toBuffer({ resolveWithObject: true }),
          });
        }
        return { metadata, palette: null, rendered };
      },
    );
    if (sourceDetails.verifiesOriginalHash) {
      assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);
    }
    if (job.kind === 'EXTRACT_COLOR_PALETTE') {
      await prisma.$transaction(async (transaction) => {
        const completed = await transaction.eagleAssetProcessingJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
          data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
        });
        if (completed.count !== 1) return;
        await transaction.eagleAssetColorAnalysis.updateMany({
          where: { ownerId: asset.ownerId, assetId: asset.id, isCurrent: true },
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
          where: { ownerId: asset.ownerId, analysisId: analysis.id },
        });
        if (processed.palette?.length) {
          await transaction.eagleAssetColorSwatch.createMany({
            data: processed.palette.map((swatch, rank) => ({
              ownerId: asset.ownerId,
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
    await prisma.$transaction(async (transaction) => {
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
        data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (completed.count !== 1) return;
      for (const rendition of renditions) {
        await transaction.eagleAssetRendition.upsert({
          where: {
            assetId_kind_revision_variant: {
              assetId: rendition.assetId,
              kind: rendition.kind,
              revision: rendition.revision,
              variant: rendition.variant ?? 'default',
            },
          },
          create: rendition,
          update: rendition,
        });
      }
      await transaction.eagleAsset.updateMany({
        where: { id: asset.id, ownerId: asset.ownerId, mediaRevision: job.assetRevision },
        data: {
          lifecycleStatus: 'READY',
          mediaErrorCode: null,
          sha256,
          width: processed.metadata.autoOrient.width ?? processed.metadata.width,
          height: processed.metadata.autoOrient.height ?? processed.metadata.height,
        },
      });
    });
    return;
  }

  if (asset.mimeType !== 'video/mp4')
    throw new PermanentMediaValidationError('UNSUPPORTED_MEDIA_TYPE');
  await processVideo(job, asset);
}

async function processVideo(
  job: EagleAssetProcessingJob,
  asset: {
    id: string;
    ownerId: string;
    originalObjectKey: string;
    uploadSessions: Array<{ eagleState: { expectedContentSha256: string | null } | null }>;
  },
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-media-video-'));
  const inputPath = join(directory, 'input.mp4');
  const posterPath = join(directory, 'poster.jpg');
  try {
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    const hash = createHash('sha256');
    const hashTap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.from(object.Body as AsyncIterable<Uint8Array>),
      hashTap,
      createWriteStream(inputPath, { flags: 'wx' }),
    );
    const sha256 = hash.digest('hex');
    assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH?.trim() || 'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { maxBuffer: 2 * 1024 * 1024, timeout: 60_000 },
    );
    const parsedProbe: unknown = JSON.parse(stdout);
    if (!parsedProbe || typeof parsedProbe !== 'object') throw new Error('INVALID_VIDEO_PROBE');
    const metadata = parseBrowserCompatibleMp4Probe(parsedProbe);
    await execFileAsync(
      process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        '0',
        '-i',
        inputPath,
        '-frames:v',
        '1',
        '-vf',
        "scale='min(800,iw)':'min(800,ih)':force_original_aspect_ratio=decrease",
        '-q:v',
        '3',
        posterPath,
      ],
      { timeout: 120_000 },
    );
    const poster = await readFile(posterPath);
    const storageKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/thumbnail.jpg`;
    await storage.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: storageKey,
        Body: poster,
        ContentType: 'image/jpeg',
      }),
    );
    await prisma.$transaction(async (transaction) => {
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
        data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (completed.count !== 1) return;
      await transaction.eagleAssetRendition.upsert({
        where: {
          assetId_kind_revision_variant: {
            assetId: asset.id,
            kind: 'THUMBNAIL',
            revision: job.assetRevision,
            variant: 'default',
          },
        },
        create: {
          ownerId: asset.ownerId,
          assetId: asset.id,
          kind: 'THUMBNAIL',
          variant: 'default',
          revision: job.assetRevision,
          storageKey,
          mimeType: 'image/jpeg',
          byteSize: BigInt(poster.byteLength),
          width: metadata.width,
          height: metadata.height,
          status: 'READY',
        },
        update: {
          storageKey,
          mimeType: 'image/jpeg',
          byteSize: BigInt(poster.byteLength),
          width: metadata.width,
          height: metadata.height,
          status: 'READY',
        },
      });
      await transaction.eagleAsset.updateMany({
        where: { id: asset.id, ownerId: asset.ownerId, mediaRevision: job.assetRevision },
        data: {
          lifecycleStatus: 'READY',
          mediaErrorCode: null,
          sha256,
          width: metadata.width,
          height: metadata.height,
          durationMs: metadata.durationMs,
        },
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function processEmbeddingJob(
  job: EagleAssetProcessingJob,
  asset: { id: string; ownerId: string },
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
  const vector = `[${embedding.join(',')}]`;
  await prisma.$transaction(async (transaction) => {
    const completed = await transaction.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
    if (completed.count !== 1) return;
    await transaction.eagleAssetEmbedding.updateMany({
      where: { ownerId: asset.ownerId, assetId: asset.id, isCurrent: true },
      data: { isCurrent: false, status: 'SUPERSEDED' },
    });
    await transaction.eagleAssetEmbedding.update({
      where: { id: record.id },
      data: {
        status: 'READY',
        isCurrent: true,
        l2Norm: 1,
        errorCode: null,
        completedAt: new Date(),
      },
    });
    await transaction.$executeRaw(
      Prisma.sql`UPDATE "EagleAssetEmbedding" SET "embedding" = ${vector}::vector WHERE "ownerId" = ${asset.ownerId} AND "id" = ${record.id}`,
    );
    await createTopSuggestion(transaction, asset.ownerId, asset.id, record.id);
  });
}

async function createTopSuggestion(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  assetId: string,
  embeddingId: string,
): Promise<void> {
  const minimumScore = boundedNumber(process.env.EAGLE_VECTOR_MINIMUM_SCORE, 0.3, -1, 1);
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleVectorTagSuggestion" (
        "id", "ownerId", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", "score", "distance", "prototypeRank", "status", "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, ${ownerId}, ${assetId}, candidate."tagId", ${embeddingId},
             candidate."snapshotId", candidate."generationId", true, 1 - candidate.distance,
             candidate.distance, candidate.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM (
        SELECT snapshot."tagId", prototype."snapshotId", snapshot."generationId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleAssetEmbedding" embedding
        JOIN "EagleTagPrototype" prototype ON prototype."ownerId" = embedding."ownerId"
        JOIN "EagleTagPrototypeSnapshot" snapshot
          ON snapshot."ownerId" = prototype."ownerId" AND snapshot.id = prototype."snapshotId"
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."tagId" = snapshot."tagId"
        WHERE embedding."ownerId" = ${ownerId} AND embedding.id = ${embeddingId}
          AND snapshot."isCurrent" = true AND snapshot.status = 'ACTIVE'
          AND config."recommendationEnabled" = true
        ORDER BY prototype.embedding <=> embedding.embedding ASC
        LIMIT 1
      ) candidate
      WHERE 1 - candidate.distance >= ${minimumScore}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = ${ownerId} AND manual."assetId" = ${assetId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM "EagleVectorTagSuggestion" existing
          WHERE existing."ownerId" = ${ownerId} AND existing."assetId" = ${assetId}
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
      where: { ownerId: build.ownerId, tagId: build.tagId, isCurrent: true },
      select: { id: true, version: true, sourceAssetCount: true },
    }),
    prisma.$queryRaw<Array<{ count: bigint; digest: string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count,
             md5(string_agg(link."assetId", ',' ORDER BY link."assetId")) AS digest
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
      WHERE link."ownerId" = ${build.ownerId} AND link."tagId" = ${build.tagId}
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
    JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset.id = link."assetId"
    JOIN "EagleAssetEmbedding" embedding
      ON embedding."ownerId" = link."ownerId" AND embedding."assetId" = link."assetId"
     AND embedding."isCurrent" = true AND embedding.status = 'READY'
    WHERE link."ownerId" = ${build.ownerId} AND link."tagId" = ${build.tagId}
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
  const snapshot = await prisma.eagleTagPrototypeSnapshot.create({
    data: {
      ownerId: build.ownerId,
      tagId: build.tagId,
      spaceId: space.id,
      version: (currentSnapshot?.version ?? 0) + 1,
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
  await prisma.eagleTagSemanticBuild.update({
    where: { id: build.id },
    data: { candidateSnapshotId: snapshot.id },
  });
  for (const prototype of prototypePlan.prototypes) {
    const vector = `[${prototype.embedding.join(',')}]`;
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "EagleTagPrototype" (
          "ownerId", "snapshotId", rank, embedding, "memberCount", weight,
          "meanDistance", "p95Distance", "representativeAssetIds", "createdAt"
        ) VALUES (
          ${build.ownerId}, ${snapshot.id}, ${prototype.rank}, ${vector}::vector,
          ${prototype.memberCount}, ${prototype.weight}, ${prototype.meanDistance},
          ${prototype.p95Distance}, ${prototype.representativeAssetIds}, NOW()
        )
      `,
    );
  }
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "EagleTagMemberDistance" (
        "ownerId", "tagId", "assetId", "snapshotId", distance, "prototypeRank", "createdAt"
      )
      SELECT link."ownerId", link."tagId", link."assetId", ${snapshot.id}, nearest.distance,
             nearest.rank, NOW()
      FROM "EagleAssetManualTag" link
      JOIN "EagleAsset" asset ON asset."ownerId" = link."ownerId" AND asset.id = link."assetId"
      JOIN "EagleAssetEmbedding" embedding
        ON embedding."ownerId" = link."ownerId" AND embedding."assetId" = link."assetId"
       AND embedding."isCurrent" = true AND embedding.status = 'READY'
      CROSS JOIN LATERAL (
        SELECT prototype.rank, prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototype" prototype
        WHERE prototype."ownerId" = ${build.ownerId} AND prototype."snapshotId" = ${snapshot.id}
        ORDER BY prototype.embedding <=> embedding.embedding
        LIMIT 1
      ) nearest
      WHERE link."ownerId" = ${build.ownerId} AND link."tagId" = ${build.tagId}
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
        WHERE distance."ownerId" = ${build.ownerId} AND distance."snapshotId" = ${snapshot.id}
        GROUP BY distance."prototypeRank"
      ) statistics
      WHERE prototype."ownerId" = ${build.ownerId}
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
        "id", "ownerId", "assetId", "suggestedTagId", "embeddingId", "snapshotId",
        "generationId", "isActive", score, distance, "prototypeRank", status, "createdAt", "updatedAt"
      )
      SELECT gen_random_uuid()::text, embedding."ownerId", embedding."assetId", nearest."tagId",
             embedding.id, nearest."snapshotId", ${generationId}, false, 1 - nearest.distance,
             nearest.distance, nearest.rank, 'PENDING'::"EagleVectorSuggestionStatus", NOW(), NOW()
      FROM "EagleAssetEmbedding" embedding
      JOIN "EagleAsset" asset ON asset."ownerId" = embedding."ownerId" AND asset.id = embedding."assetId"
      CROSS JOIN LATERAL (
        SELECT snapshot."tagId", snapshot.id AS "snapshotId", prototype.rank,
               prototype.embedding <=> embedding.embedding AS distance
        FROM "EagleTagPrototypeSnapshot" snapshot
        JOIN "EagleTagPrototype" prototype
          ON prototype."ownerId" = snapshot."ownerId" AND prototype."snapshotId" = snapshot.id
        JOIN "EagleManualTagSemanticConfig" config
          ON config."ownerId" = snapshot."ownerId" AND config."tagId" = snapshot."tagId"
        WHERE snapshot."ownerId" = embedding."ownerId"
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
      WHERE embedding."ownerId" = ${build.ownerId} AND embedding."isCurrent" = true
        AND embedding.status = 'READY' AND asset."deletedAt" IS NULL
        AND 1 - nearest.distance >= ${minimumScore}
        AND NOT EXISTS (
          SELECT 1 FROM "EagleAssetManualTag" manual
          WHERE manual."ownerId" = embedding."ownerId" AND manual."assetId" = embedding."assetId"
        )
    `,
  );
  await prisma.$transaction(async (transaction) => {
    await transaction.eagleVectorTagSuggestion.updateMany({
      where: { ownerId: build.ownerId, isActive: true, status: 'PENDING', invalidatedAt: null },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        invalidReason: 'PROTOTYPE_GENERATION_REPLACED',
      },
    });
    if (candidateSnapshotId) {
      await transaction.eagleTagPrototypeSnapshot.updateMany({
        where: { ownerId: build.ownerId, tagId: build.tagId, isCurrent: true },
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
      where: { ownerId: build.ownerId, generationId, status: 'PENDING', invalidatedAt: null },
      data: { isActive: true },
    });
    await transaction.eagleTagSemanticBuild.updateMany({
      where: { id: build.id, status: 'PROCESSING', leaseVersion: build.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
  });
}

async function failTagSemanticBuild(build: EagleTagSemanticBuild, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_TAG_BUILD_ERROR';
  const terminal = build.attempts >= 5 || message === 'TAG_RECOMMENDATION_DISABLED';
  const delaySeconds = Math.min(3_600, 2 ** Math.min(build.attempts, 12));
  await prisma.$transaction(async (transaction) => {
    await transaction.eagleTagSemanticBuild.updateMany({
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
  const asset = await prisma.eagleAsset.findFirst({
    where: {
      id: job.assetId,
      ownerId: job.ownerId,
      mediaRevision: job.assetRevision,
      deletedAt: { not: null },
      purgeAfter: { lte: new Date() },
    },
    include: {
      renditions: { select: { storageKey: true } },
      imagePyramids: { select: { storagePrefix: true } },
    },
  });
  if (!asset) {
    await prisma.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
    return;
  }
  const keys = [asset.originalObjectKey, ...asset.renditions.map(({ storageKey }) => storageKey)];
  for (const key of keys) {
    assertOwnedKey(asset.ownerId, key);
    await storage.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
  }
  for (const { storagePrefix } of asset.imagePyramids) {
    await deleteOwnedPrefix(asset.ownerId, `${storagePrefix}/`);
  }
  await prisma.eagleAsset.deleteMany({
    where: {
      id: asset.id,
      ownerId: asset.ownerId,
      mediaRevision: job.assetRevision,
      deletedAt: { not: null },
      purgeAfter: { lte: new Date() },
    },
  });
}

async function failJob(job: EagleAssetProcessingJob, error: unknown): Promise<void> {
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
          assetId: job.assetId,
          assetRevision: job.assetRevision,
          spaceId: embeddingSpaceId,
        },
        data: {
          status: terminal ? 'FAILED' : 'PENDING',
          errorCode: message.slice(0, 100),
          completedAt: terminal ? new Date() : null,
        },
      });
    }
    if (terminal && taskBlocksAssetReady(job.kind)) {
      await transaction.eagleAsset.updateMany({
        where: { id: job.assetId, ownerId: job.ownerId, mediaRevision: job.assetRevision },
        data: { lifecycleStatus: 'FAILED', mediaErrorCode: message.slice(0, 100) },
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
      await storage.send(
        new DeleteObjectsCommand({
          Bucket: s3Bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function poll(): Promise<void> {
  if (stopping || activeJobCount >= workerConcurrency) return;
  while (!stopping && activeJobCount < workerConcurrency) {
    const job = await claimJob();
    if (!job) {
      const tagBuild = await claimTagBuild();
      if (!tagBuild) return;
      activeJobCount += 1;
      void processClaimedTagBuild(tagBuild);
      continue;
    }
    activeJobCount += 1;
    void processClaimedJob(job);
  }
}

async function processClaimedTagBuild(build: EagleTagSemanticBuild): Promise<void> {
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
    activeJobCount -= 1;
    void poll().catch(reportLoopError);
  }
}

async function processClaimedJob(job: EagleAssetProcessingJob): Promise<void> {
  const startedRss = process.memoryUsage().rss;
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
    activeJobCount -= 1;
    void poll().catch(reportLoopError);
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
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  process.stdout.write(`SekerEagle worker received ${signal}\n`);
  while (activeJobCount > 0) await new Promise((resolve) => setTimeout(resolve, 100));
  await prisma.eagleProcessingWorkerHeartbeat.deleteMany({ where: { workerId } });
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 0;
}

async function main(): Promise<void> {
  await heartbeat();
  process.stdout.write(`SekerEagle worker ready: ${workerId}\n`);
  pollTimer = setInterval(() => void poll().catch(reportLoopError), 1_000);
  heartbeatTimer = setInterval(() => void heartbeat().catch(reportLoopError), 15_000);
  await poll();
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
