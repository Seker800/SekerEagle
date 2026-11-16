import { GetObjectCommand } from '@aws-sdk/client-s3';
import { inferPhotoFaces, persistPhotoFaces } from '../photo-faces';
import { selectImageJobSource } from '../image-job-source';
import { assertOwnedKey, readBoundedBytes } from './shared';
import type { AssetFamilyHandler } from './types';

export const facesJob: AssetFamilyHandler = async (
  { job, remoteRequired, context },
  asset,
) => {
  if (asset.libraryMode !== 'PHOTO') throw new Error('PHOTO_FACE_LIBRARY_MISMATCH');
  const preview = selectImageJobSource(asset, job.kind);
  assertOwnedKey(asset.ownerId, preview.storageKey);
  const object = await context.storage.send(
    new GetObjectCommand({ Bucket: context.s3Bucket, Key: preview.storageKey }),
  );
  if (!object.Body) throw new Error('PHOTO_FACE_PREVIEW_MISSING');
  const bytes = await readBoundedBytes(
    object.Body as AsyncIterable<Uint8Array>,
    20 * 1024 * 1024,
  );
  await persistPhotoFaces(
    context.prisma,
    job,
    remoteRequired
      ? await context.remoteMediaClient.faces(bytes)
      : await inferPhotoFaces(bytes),
  );
};
