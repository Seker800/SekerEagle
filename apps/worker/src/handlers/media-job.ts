import { isCameraVideoMime, mediaExecutionGuard } from '@sekereagle/library-core';
import { RemoteMediaUnavailableError } from '../remote-media';
import { facesJob } from './faces-job';
import { imageJob } from './image-job';
import { loadJobAsset } from './job-asset';
import { videoJob } from './video-job';
import type { JobHandler } from './types';

export const assetJob: JobHandler = async (execution) => {
  const { job, remoteRequired, context } = execution;
  const asset = await loadJobAsset(context.prisma, job);
  if (!asset) {
    await context.prisma.eagleAssetProcessingJob.updateMany({
      where: mediaExecutionGuard(job),
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        lockedAt: null,
        lastError: 'ASSET_TRASHED',
      },
    });
    return;
  }
  if (
    remoteRequired &&
    !asset.mimeType.startsWith('image/') &&
    !isCameraVideoMime(asset.mimeType)
  )
    throw new RemoteMediaUnavailableError();
  if (job.kind === 'ANALYZE_PHOTO_FACES') return facesJob(execution, asset);
  if (asset.mimeType.startsWith('image/')) return imageJob(execution, asset);
  return videoJob(execution, asset);
};
