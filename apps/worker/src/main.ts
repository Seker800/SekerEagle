import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient, type EagleAssetProcessingJob, type Prisma } from '@prisma/client';
import { assertSafeRuntimeTarget, describeRuntimeTarget } from '@sekereagle/config';
import sharp from 'sharp';
import { canClaimBackgroundJobs } from './processing-policy';
import { extractRepresentativeColors } from './color-palette';

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

async function heartbeat(): Promise<void> {
  const now = new Date();
  await prisma.eagleProcessingWorkerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, version: workerVersion, startedAt: now, heartbeatAt: now, activeJobCount },
    update: { heartbeatAt: now, activeJobCount },
  });
}

async function claimJob(): Promise<EagleAssetProcessingJob | null> {
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000);
  const candidates = await prisma.eagleAssetProcessingJob.findMany({
    where: {
      OR: [
        { status: 'PENDING', availableAt: { lte: new Date() } },
        { status: 'PROCESSING', lockedAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: 50,
  });
  const ordered = candidates.sort(
    (left, right) => lanePriority(left.lane) - lanePriority(right.lane),
  );
  let candidate: EagleAssetProcessingJob | undefined;
  for (const pending of ordered) {
    if (pending.lane !== 'BACKGROUND' || (await canClaimBackgroundForOwner(pending.ownerId))) {
      candidate = pending;
      break;
    }
  }
  if (!candidate) return null;
  const claimed = await prisma.eagleAssetProcessingJob.updateMany({
    where: {
      id: candidate.id,
      leaseVersion: candidate.leaseVersion,
      ...(candidate.status === 'PENDING'
        ? { status: 'PENDING' as const }
        : { status: 'PROCESSING' as const, lockedAt: { lt: staleBefore } }),
    },
    data: {
      status: 'PROCESSING',
      lockedAt: new Date(),
      startedAt: candidate.startedAt ?? new Date(),
      attempts: { increment: 1 },
      leaseVersion: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.eagleAssetProcessingJob.findUniqueOrThrow({ where: { id: candidate.id } });
}

function lanePriority(lane: EagleAssetProcessingJob['lane']): number {
  return lane === 'INTERACTIVE' ? 0 : lane === 'BACKGROUND' ? 1 : 2;
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
      uploadSessions: {
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 1,
        select: { eagleState: { select: { expectedContentSha256: true } } },
      },
    },
  });
  if (!asset) throw new Error('ASSET_NOT_PROCESSABLE');
  assertOwnedKey(asset.ownerId, asset.originalObjectKey);

  if (asset.mimeType.startsWith('image/')) {
    if (asset.byteSize > 250n * 1024n * 1024n) throw new Error('IMAGE_TOO_LARGE_TO_PROCESS');
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    const input = Buffer.from(await object.Body.transformToByteArray());
    const sha256 = createHash('sha256').update(input).digest('hex');
    assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);
    const metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: 200_000_000,
    }).metadata();
    if (job.kind === 'EXTRACT_COLOR_PALETTE') {
      const { data, info } = await sharp(input, {
        failOn: 'error',
        limitInputPixels: 200_000_000,
      })
        .rotate()
        .toColourspace('srgb')
        .resize({ width: 192, height: 192, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const palette = extractRepresentativeColors(
        data,
        info.channels,
        info.width * info.height,
        6,
      );
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
        if (palette.length) {
          await transaction.eagleAssetColorSwatch.createMany({
            data: palette.map((swatch, rank) => ({
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
    const renditionSpecs = [
      { kind: 'THUMBNAIL' as const, maxSize: 480 },
      { kind: 'PREVIEW' as const, maxSize: 1600 },
    ];
    const renditions: Prisma.EagleAssetRenditionUncheckedCreateInput[] = [];
    for (const spec of renditionSpecs) {
      const rendered = await sharp(input, { failOn: 'error', limitInputPixels: 200_000_000 })
        .rotate()
        .resize({
          width: spec.maxSize,
          height: spec.maxSize,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: spec.kind === 'THUMBNAIL' ? 78 : 86 })
        .toBuffer({ resolveWithObject: true });
      const storageKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/${spec.kind.toLowerCase()}.webp`;
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
            assetId_kind_revision: {
              assetId: rendition.assetId,
              kind: rendition.kind,
              revision: rendition.revision,
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
          width: metadata.autoOrient.width ?? metadata.width,
          height: metadata.autoOrient.height ?? metadata.height,
        },
      });
    });
    return;
  }

  const object = await storage.send(
    new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
  );
  if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
  const verified = await verifyStream(object.Body as AsyncIterable<Uint8Array>, asset.mimeType);
  assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, verified.sha256);
  await prisma.$transaction(async (transaction) => {
    const completed = await transaction.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
    });
    if (completed.count !== 1) return;
    await transaction.eagleAsset.updateMany({
      where: { id: asset.id, ownerId: asset.ownerId, mediaRevision: job.assetRevision },
      data: { lifecycleStatus: 'READY', mediaErrorCode: null, sha256: verified.sha256 },
    });
  });
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
    include: { renditions: { select: { storageKey: true } } },
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
  const terminal = job.attempts >= 3;
  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.eagleAssetProcessingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
      data: terminal
        ? { status: 'FAILED', completedAt: new Date(), lockedAt: null, lastError: message }
        : {
            status: 'PENDING',
            availableAt: new Date(Date.now() + 30_000 * 2 ** Math.max(0, job.attempts - 1)),
            lockedAt: null,
            lastError: message,
          },
    });
    if (terminal && failed.count === 1) {
      await transaction.eagleAsset.updateMany({
        where: { id: job.assetId, ownerId: job.ownerId, mediaRevision: job.assetRevision },
        data: { lifecycleStatus: 'FAILED', mediaErrorCode: message.slice(0, 100) },
      });
    }
  });
}

async function poll(): Promise<void> {
  if (stopping || activeJobCount > 0) return;
  const job = await claimJob();
  if (!job) return;
  activeJobCount += 1;
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
    process.stdout.write(`completed media job ${job.id}\n`);
  } catch (error) {
    if (leaseHeld) await failJob(job, error);
    const message = error instanceof Error ? error.message : 'unknown media error';
    process.stderr.write(`failed media job ${job.id}: ${message}\n`);
  } finally {
    clearInterval(renewal);
    activeJobCount -= 1;
  }
}

function assertOwnedKey(ownerId: string, key: string): void {
  if (!key.startsWith(`users/${ownerId}/`)) throw new Error('CROSS_OWNER_OBJECT_KEY');
}

function assertExpectedHash(expected: string | null | undefined, actual: string): void {
  if (expected && expected !== actual) throw new Error('CONTENT_SHA256_MISMATCH');
}

async function verifyStream(
  stream: AsyncIterable<Uint8Array>,
  mimeType: string,
): Promise<{ sha256: string }> {
  const hash = createHash('sha256');
  const prefixParts: Buffer[] = [];
  let prefixLength = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    if (prefixLength < 16) {
      const prefix = bytes.subarray(0, 16 - prefixLength);
      prefixParts.push(prefix);
      prefixLength += prefix.byteLength;
    }
  }
  const prefix = Buffer.concat(prefixParts);
  if (mimeType === 'application/pdf' && prefix.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('MEDIA_SIGNATURE_MISMATCH');
  }
  if (
    ['video/mp4', 'video/quicktime'].includes(mimeType) &&
    prefix.subarray(4, 8).toString('ascii') !== 'ftyp'
  ) {
    throw new Error('MEDIA_SIGNATURE_MISMATCH');
  }
  if (
    mimeType === 'video/webm' &&
    !prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    throw new Error('MEDIA_SIGNATURE_MISMATCH');
  }
  return { sha256: hash.digest('hex') };
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

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
void main().catch(async (error: unknown) => {
  reportLoopError(error);
  await prisma.$disconnect();
  storage.destroy();
  process.exitCode = 1;
});
