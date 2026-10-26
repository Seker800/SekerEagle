import { mediaCompletion } from '@sekereagle/library-core';
import { createHash, randomUUID } from 'node:crypto';
import type { EagleAssetProcessingJob, PrismaClient, Prisma } from '@prisma/client';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { readPhotoEditRecipe } from '@sekereagle/library-core';
import {
  buildImageProcessingJobs,
  editedCopyTag,
  inheritEditedCopyDetails,
  inheritPhotoEditedCopy,
  lockOwnerPrivacyProjection,
} from '@sekereagle/library-persistence';
import { renderServerPhoto } from '@sekereagle/photo-render-core/server';
import { readPortableLut } from '@sekereagle/photo-render-core/portable-lut';
import { withProcessableImage } from './image-media';
/** Original bytes never leave storage/worker; publication is fenced by the existing media lease. */
export async function renderEditedCopy(
  db: PrismaClient,
  storage: S3Client,
  bucket: string,
  job: EagleAssetProcessingJob,
) {
  const row = await db.eagleEditRender.findFirst({
    where: { jobId: job.id, ownerId: job.ownerId, libraryMode: job.libraryMode },
  });
  const where = {
    id: job.assetId,
    ownerId: job.ownerId,
    libraryMode: job.libraryMode,
    mediaRevision: job.assetRevision,
    deletedAt: null,
    purgeAfter: null,
  };
  const source = await db.eagleAsset.findFirst({ where });
  if (!row || !source || source.rowVersion !== row.sourceRowVersion)
    throw new Error('EDIT_SOURCE_CHANGED');
  if (!source.originalObjectKey.startsWith(`users/${job.ownerId}/assets/`))
    throw new Error('EDIT_SOURCE_SCOPE');
  const recipe = readPhotoEditRecipe(row.recipe);
  const lut = row.lut;
  const object = await storage.send(
    new GetObjectCommand({ Bucket: bucket, Key: source.originalObjectKey }),
  );
  if (!object.Body) throw new Error('EDIT_SOURCE_MISSING');
  const { result: bytes, sha256 } = await withProcessableImage(
    object.Body as AsyncIterable<Uint8Array>,
    source.mimeType,
    source.originalObjectKey,
    async (image) =>
      renderServerPhoto(
        await image.clone().rotate().png().toBuffer(),
        recipe.edits,
        {},
        lut ? readPortableLut(lut) : undefined,
      ),
  );
  if (source.sha256 && source.sha256 !== sha256) throw new Error('EDIT_SOURCE_HASH_MISMATCH');
  const dimensions = await sharp(bytes).metadata();
  const id = randomUUID();
  const key = `users/${job.ownerId}/assets/${id}/original.png`;
  const digest = createHash('sha256').update(bytes).digest('hex');
  // An outbox precedes PUT: a crash or ambiguous storage response cannot strand an object.
  // Publication removes it atomically; uncertain DB commits never trigger an unsafe direct delete.
  const orphan = await db.eagleObjectDeletion.create({
    data: {
      ownerId: job.ownerId,
      libraryMode: job.libraryMode,
      objectKeys: [key],
      prefixes: [],
      availableAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  let committed = false;
  try {
    await storage.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'image/png' }),
    );
    committed = await db.$transaction(
      async (tx) => {
        await lockOwnerPrivacyProjection(tx, job.ownerId, job.libraryMode);
        if (job.libraryMode === 'PHOTO')
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`photo-groups:${job.ownerId}`}))`;
        await tx.$queryRaw`SELECT id FROM "EagleAsset" WHERE id=${job.assetId} AND "ownerId"=${job.ownerId} AND "libraryMode"=${job.libraryMode}::"LibraryMode" FOR UPDATE`;
        const current = await tx.eagleAsset.findFirst({
          where: {
            ...where,
            rowVersion: row.sourceRowVersion,
            originalObjectKey: source.originalObjectKey,
          },
          include: {
            annotation: true,
            manualTagLinks: { include: { tag: { select: { marksAssetsPrivate: true } } } },
          },
        });
        if (!current) throw new Error('EDIT_SOURCE_CHANGED');
        const lease = await tx.eagleAssetProcessingJob.updateMany({
          ...mediaCompletion(job),
        });
        if (lease.count !== 1) return false;
        const retained = await tx.eagleObjectDeletion.deleteMany({
          where: { id: orphan.id, status: 'PENDING' },
        });
        if (retained.count !== 1) throw new Error('EDIT_PUBLICATION_EXPIRED');
        const tag = await editedCopyTag(tx, job.ownerId, job.libraryMode);
        const name = `${source.displayName || source.originalName.replace(/\.[^.]+$/, '')}-已编辑.png`;
        await tx.eagleAsset.create({
          data: {
            id,
            ownerId: job.ownerId,
            libraryMode: job.libraryMode,
            originalName: name,
            displayName: name,
            normalizedDisplayName: name.normalize('NFKC').toLowerCase(),
            mimeType: 'image/png',
            format: 'png',
            mediaRevision: 1,
            byteSize: BigInt(bytes.length),
            originalObjectKey: key,
            sha256: digest,
            width: dimensions.width,
            height: dimensions.height,
            rating: current.rating,
            isPrivate: current.isPrivate || tag.marksAssetsPrivate,
          },
        });
        await inheritEditedCopyDetails(tx, job.ownerId, job.libraryMode, id, current, tag);
        await tx.eagleAssetEditRecipe.create({
          data: {
            ownerId: job.ownerId,
            libraryMode: job.libraryMode,
            assetId: id,
            assetRevision: 1,
            baseAssetId: job.assetId,
            baseMediaRevision: job.assetRevision,
            recipe: recipe as unknown as Prisma.InputJsonValue,
          },
        });
        if (job.libraryMode === 'PHOTO')
          await inheritPhotoEditedCopy(
            tx,
            { ownerId: job.ownerId, libraryMode: job.libraryMode },
            { sourceAssetId: job.assetId, assetId: id, mediaRevision: 1 },
          );
        await tx.eagleAssetProcessingJob.createMany({
          data: buildImageProcessingJobs({
            ownerId: job.ownerId,
            assetId: id,
            assetRevision: 1,
            width: dimensions.width ?? null,
            height: dimensions.height ?? null,
          }).map((data) => ({ ...data, libraryMode: job.libraryMode })),
        });
        await tx.eagleEditRender.update({ where: { jobId: job.id }, data: { resultAssetId: id } });
        return true;
      },
      { timeout: 30000 },
    );
  } finally {
    if (!committed)
      await db.eagleObjectDeletion.updateMany({
        where: { id: orphan.id, status: 'PENDING' },
        data: { availableAt: new Date() },
      });
  }
}
