import { videoProcessingStage, VIDEO_PLAYBACK_PROCESSOR_VERSION } from './video-processing-policy';
import { CAMERA_MAX_VIDEO_BYTES } from '@sekereagle/library-core';
import {
  probeCameraVideo,
  transcodeCameraVideo,
  CAMERA_VIDEO_INPUT_OPTIONS,
  mediaSubprocessEnvironment,
} from '@sekereagle/media-core';
import type { Prisma, PrismaClient, EagleAssetProcessingJob, LibraryMode } from '@prisma/client';
import { type S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import sharp from 'sharp';
const execFileAsync = promisify(execFile);
interface VideoProcessingDependencies {
  prisma: PrismaClient;
  storage: S3Client;
  s3Bucket: string;
  transcodingEnabled: boolean;
  lockPrivacy: (
    transaction: Prisma.TransactionClient,
    ownerId: string,
    mode: LibraryMode,
  ) => Promise<void>;
  syncPrivacy: (
    transaction: Prisma.TransactionClient,
    ownerId: string,
    ids: string[],
    mode: LibraryMode,
  ) => Promise<unknown>;
  assertExpectedHash(this: void, expected: string | null | undefined, actual: string): void;
}

export async function processVideo(
  job: EagleAssetProcessingJob,
  asset: {
    id: string;
    ownerId: string;
    libraryMode: LibraryMode;
    originalObjectKey: string;
    mimeType: string;
    uploadSessions: Array<{ eagleState: { expectedContentSha256: string | null } | null }>;
  },
  dependencies: VideoProcessingDependencies,
): Promise<void> {
  const {
    prisma,
    storage,
    s3Bucket,
    assertExpectedHash,
    transcodingEnabled,
    lockPrivacy,
    syncPrivacy,
  } = dependencies;
  const stage = videoProcessingStage(job.kind, transcodingEnabled);
  const directory = await mkdtemp(join(tmpdir(), 'sekereagle-media-video-'));
  const inputPath = join(directory, 'input.mp4');
  const posterPath = join(directory, 'poster.jpg');
  const previewPath = join(directory, 'preview.mp4');
  try {
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    const hash = createHash('sha256');
    let inputBytes = 0;
    const hashTap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        inputBytes += chunk.byteLength;
        if (inputBytes > CAMERA_MAX_VIDEO_BYTES)
          return callback(new Error('VIDEO_SIZE_LIMIT_EXCEEDED'));
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
    const metadata = await probeCameraVideo(inputPath, asset.mimeType);
    const playbackMetadata =
      stage === 'POSTER'
        ? null
        : await transcodeCameraVideo(inputPath, previewPath, metadata.durationMs);
    if (stage !== 'PLAYBACK') {
      await execFileAsync(
        process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
        [
          '-v',
          'error',
          '-y',
          '-ss',
          '0',
          ...CAMERA_VIDEO_INPUT_OPTIONS,
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
        { env: mediaSubprocessEnvironment(), timeout: 120_000 },
      );
    }
    const poster = stage === 'PLAYBACK' ? null : await readFile(posterPath);
    const posterMetadata = poster ? await sharp(poster).metadata() : null;
    const playbackKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/preview.mp4`;
    const playbackSize = playbackMetadata ? (await stat(previewPath)).size : 0;
    if (playbackMetadata)
      await storage.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: playbackKey,
          Body: createReadStream(previewPath),
          ContentLength: playbackSize,
          ContentType: 'video/mp4',
        }),
      );
    const storageKey = `users/${asset.ownerId}/assets/${asset.id}/renditions/${job.assetRevision}/thumbnail.jpg`;
    if (poster)
      await storage.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: storageKey,
          Body: poster,
          ContentType: 'image/jpeg',
        }),
      );
    await prisma.$transaction(async (transaction) => {
      await lockPrivacy(transaction, asset.ownerId, asset.libraryMode);
      const completed = await transaction.eagleAssetProcessingJob.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseVersion: job.leaseVersion },
        data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
      });
      if (completed.count !== 1) return;
      if (playbackMetadata) {
        const playbackData = {
          storageKey: playbackKey,
          mimeType: 'video/mp4',
          byteSize: BigInt(playbackSize),
          width: playbackMetadata.width,
          height: playbackMetadata.height,
          status: 'READY' as const,
        };
        await transaction.eagleAssetRendition.upsert({
          where: {
            assetId_kind_revision_variant: {
              assetId: asset.id,
              kind: 'PREVIEW',
              revision: job.assetRevision,
              variant: 'default',
            },
          },
          create: {
            ...playbackData,
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            assetId: asset.id,
            kind: 'PREVIEW',
            variant: 'default',
            revision: job.assetRevision,
          },
          update: playbackData,
        });
      }
      if (poster && posterMetadata) {
        await transaction.eagleAssetRendition.upsert({
          where: {
            assetId_kind_revision_variant: {
              assetId: asset.id,
              kind: 'THUMBNAIL',
              revision: job.assetRevision,
              variant: 'poster',
            },
          },
          create: {
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            assetId: asset.id,
            kind: 'THUMBNAIL',
            variant: 'poster',
            revision: job.assetRevision,
            storageKey,
            mimeType: 'image/jpeg',
            byteSize: BigInt(poster.byteLength),
            width: posterMetadata.width,
            height: posterMetadata.height,
            status: 'READY',
          },
          update: {
            storageKey,
            mimeType: 'image/jpeg',
            byteSize: BigInt(poster.byteLength),
            width: posterMetadata.width,
            height: posterMetadata.height,
            status: 'READY',
          },
        });
      }
      if (stage === 'POSTER') {
        await transaction.eagleAssetProcessingJob.createMany({
          data: [
            {
              ownerId: asset.ownerId,
              libraryMode: asset.libraryMode,
              assetId: asset.id,
              assetRevision: job.assetRevision,
              kind: 'GENERATE_PREVIEW',
              lane: 'BACKGROUND',
              processorVersion: VIDEO_PLAYBACK_PROCESSOR_VERSION,
            },
          ],
          skipDuplicates: true,
        });
      }
      if (stage === 'PLAYBACK')
        await transaction.eagleAsset.updateMany({
          where: {
            id: asset.id,
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            mediaRevision: job.assetRevision,
            mediaErrorCode: 'VIDEO_PLAYBACK_FAILED',
          },
          data: { mediaErrorCode: null },
        });
      if (stage !== 'PLAYBACK')
        await transaction.eagleAsset.updateMany({
          where: {
            id: asset.id,
            ownerId: asset.ownerId,
            libraryMode: asset.libraryMode,
            mediaRevision: job.assetRevision,
          },
          data: {
            lifecycleStatus: 'READY',
            mediaErrorCode: null,
            sha256,
            width: metadata.width,
            height: metadata.height,
            durationMs: metadata.durationMs,
            livePhotoIdentifier: metadata.livePhotoIdentifier ?? null,
            livePhotoRole: metadata.livePhotoIdentifier ? 'MOTION' : null,
          },
        });
      await syncPrivacy(transaction, asset.ownerId, [asset.id], asset.libraryMode);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
