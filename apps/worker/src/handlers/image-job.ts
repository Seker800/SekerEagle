import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CAMERA_MAX_IMAGE_BYTES,
  PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION,
  isCameraRawMime,
  mediaExecutionGuard,
} from '@sekereagle/library-core';
import type { Prisma } from '@prisma/client';
import { extname } from 'node:path';
import { catalogImageDimensions, canReuseImageBrowsing } from '../image-renditions';
import { inspectJpegLivePhoto, inspectLivePhotoStream } from '../live-photo';
import { readOwnedImageRange } from '../image-range';
import { processImageWork } from '../image-work';
import { publishImage } from '../image-publication';
import { MediaOutputAttempt } from '../media-output-attempt';
import { selectImageJobSource } from '../image-job-source';
import { PermanentMediaValidationError } from '../media-validation-error';
import { generateImagePyramid } from './image-pyramid';
import { assertExpectedHash, assertOwnedKey } from './shared';
import type { AssetFamilyHandler } from './types';

export const imageJob: AssetFamilyHandler = async ({ job, remoteRequired, context }, asset) => {
  const execution = { job, remoteRequired, context };
  if (asset.mimeType.startsWith('image/') && canReuseImageBrowsing(job, asset)) {
    await publishImage(context.prisma, {
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
    await context.prisma.eagleAssetColorAnalysis.upsert({
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

  // The same queue, policy and lease guard handle both inference and stored-vector activation.
  // Check before selecting or reading an object: a SEND must not download or infer again.
  if (job.kind === 'GENERATE_EMBEDDING' && (await context.embeddingProcessor.activateStored(job)))
    return;
  if (asset.mimeType.startsWith('image/')) {
    if (asset.byteSize > BigInt(CAMERA_MAX_IMAGE_BYTES))
      throw new PermanentMediaValidationError(
        'IMAGE_CONTENT_MISMATCH',
        'IMAGE_TOO_LARGE_TO_PROCESS',
      );
    const sourceDetailsOnly = job.processorVersion === PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION;
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
    const object = await context.storage.send(
      new GetObjectCommand({ Bucket: context.s3Bucket, Key: sourceDetails.storageKey }),
    );
    if (!object.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
    if (job.kind === 'GENERATE_EMBEDDING') {
      await context.embeddingProcessor.infer(
        job,
        sourceDetails.mimeType,
        object.Body as AsyncIterable<Uint8Array>,
      );
      return;
    }
    const deferDetails =
      !sourceDetailsOnly && (isCameraRawMime(asset.mimeType) || asset.libraryMode === 'PHOTO');
    if (job.kind === 'GENERATE_IMAGE_PYRAMID') {
      await generateImagePyramid(execution, asset, object.Body as AsyncIterable<Uint8Array>);
      return;
    }
    const imageWork = {
      assetMimeType: asset.mimeType,
      sourceMimeType: sourceDetails.mimeType,
      sourceExtension: ['.heic', '.heif'].includes(extname(sourceDetails.storageKey).toLowerCase())
        ? extname(sourceDetails.storageKey).toLowerCase()
        : undefined,
      kind: job.kind,
      processorVersion: job.processorVersion,
      mode: asset.libraryMode,
      detailsOnly: sourceDetailsOnly,
      verifiesOriginalHash: sourceDetails.verifiesOriginalHash,
    };
    const {
      result: processed,
      sha256,
      sourceMode,
    } = await (
      remoteRequired
        ? context.remoteMediaClient.image.bind(context.remoteMediaClient)
        : processImageWork
    )(object.Body as AsyncIterable<Uint8Array>, imageWork);
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
      await context.prisma.$transaction(async (transaction) => {
        const completed = await transaction.eagleAssetProcessingJob.updateMany({
          where: mediaExecutionGuard(job),
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
    const outputAttempt = new MediaOutputAttempt(context.prisma, asset, 'renditions');
    let published = false;
    try {
      const renditions: Prisma.EagleAssetRenditionUncheckedCreateInput[] = [];
      for (const { spec, output: rendered } of processed.rendered ?? []) {
        const storageKey = outputAttempt.key(`${spec.kind.toLowerCase()}-${spec.variant}.webp`);
        await outputAttempt.prepare();
        await context.storage.send(
          new PutObjectCommand({
            Bucket: context.s3Bucket,
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
              (input) => context.storage.send(new GetObjectCommand(input)),
              {
                bucket: context.s3Bucket,
                ownerId: asset.ownerId,
                key: asset.originalObjectKey,
                byteSize: Number(asset.byteSize),
              },
              start,
              length,
            ),
          );
        } else if (asset.mimeType === 'image/heic' || asset.mimeType === 'image/heif') {
          const original = await context.storage.send(
            new GetObjectCommand({ Bucket: context.s3Bucket, Key: asset.originalObjectKey }),
          );
          if (!original.Body) throw new Error('ORIGINAL_OBJECT_MISSING');
          livePhoto = await inspectLivePhotoStream(
            original.Body as AsyncIterable<Uint8Array>,
            asset.sha256!,
          );
        }
      }
      if (livePhoto?.motion) {
        const motionKey = outputAttempt.key('motion.mp4');
        await outputAttempt.prepare();
        await context.storage.send(
          new PutObjectCommand({
            Bucket: context.s3Bucket,
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
      published = await publishImage(context.prisma, {
        outputAttempt,
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
        scheduleFaces:
          context.facesConfigured || context.remoteKinds().includes('ANALYZE_PHOTO_FACES'),
        deferDetails,
        preserveBrowseState: sourceDetailsOnly,
      });
    } finally {
      await outputAttempt.finish(published);
    }
    return;
  }
};
