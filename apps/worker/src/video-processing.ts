import { renderVideoWork } from './video-work';
import type { RemoteMediaClient } from './remote-media';
import { mediaCompletion } from '@sekereagle/library-core';
import { videoProcessingStage, VIDEO_PLAYBACK_PROCESSOR_VERSION } from './video-processing-policy';
import type { Prisma, PrismaClient, EagleAssetProcessingJob, LibraryMode } from '@prisma/client';
import { type S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
interface VideoProcessingDependencies {
  remote?: RemoteMediaClient;
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
  const posterPath = join(directory, 'poster.jpg');
  const previewPath = join(directory, 'preview.mp4');
  try {
    const object = await storage.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: asset.originalObjectKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    const work = { mimeType: asset.mimeType, stage };
    const source = object.Body as AsyncIterable<Uint8Array>;
    const manifest = dependencies.remote
      ? await dependencies.remote.video(source, work, directory)
      : (await renderVideoWork(source, work, directory)).manifest;
    const { sha256, metadata, playbackMetadata } = manifest;
    assertExpectedHash(asset.uploadSessions[0]?.eagleState?.expectedContentSha256, sha256);
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
        ...mediaCompletion(job),
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
