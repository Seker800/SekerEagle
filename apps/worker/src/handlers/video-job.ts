import { isCameraVideoMime } from '@sekereagle/library-core';
import { lockOwnerPrivacyProjection, syncAssetPrivacy } from '@sekereagle/library-persistence';
import { PermanentMediaValidationError } from '../media-validation-error';
import { processVideo } from '../video-processing';
import { assertExpectedHash } from './shared';
import type { AssetFamilyHandler } from './types';

export const videoJob: AssetFamilyHandler = async (
  { job, remoteRequired, context },
  asset,
) => {
  if (!isCameraVideoMime(asset.mimeType))
    throw new PermanentMediaValidationError('UNSUPPORTED_MEDIA_TYPE');
  await processVideo(job, asset, {
    remote: remoteRequired ? context.remoteMediaClient : undefined,
    prisma: context.prisma,
    storage: context.storage,
    s3Bucket: context.s3Bucket,
    assertExpectedHash,
    transcodingEnabled: context.runVideoTranscoding,
    lockPrivacy: lockOwnerPrivacyProjection,
    syncPrivacy: syncAssetPrivacy,
  });
};
