import type { EagleAssetProcessingJob } from '@prisma/client';
import { imageWorkMemoryMiB } from './image-work-budget';
import type { MediaResource } from './media-resource-pool';
/** Conservative in-flight reservations for the existing 2 GiB NAS worker.
 * Leave 512 MiB for runtime/maintenance. This is not a hard bound on a codec's RSS.
 */
export const WORKER_INFLIGHT_MEMORY_MIB = 1536;
export function mediaMemoryMiB(
  resource: MediaResource,
  job: Pick<EagleAssetProcessingJob, 'kind'> &
    Partial<Pick<EagleAssetProcessingJob, 'processorVersion' | 'libraryMode'>>,
) {
  if (resource === 'EMBEDDING') return 64;
  if (job.kind === 'ANALYZE_PHOTO_FACES') return resource === 'REMOTE_MEDIA' ? 64 : 384;
  if (resource === 'REMOTE_MEDIA' && job.kind === 'GENERATE_IMAGE_PYRAMID') return 128;
  if (resource === 'REMOTE_MEDIA' && job.kind === 'EXTRACT_COLOR_PALETTE') return 64;
  if (
    resource === 'REMOTE_MEDIA' &&
    ['camera-video-preview-v2', 'camera-video-playback-v1'].includes(job.processorVersion ?? '')
  )
    return 128;
  if (resource === 'REMOTE_MEDIA')
    return imageWorkMemoryMiB({
      kind: job.kind,
      mode: job.libraryMode ?? 'MATERIAL',
      detailsOnly: job.processorVersion === 'photo-source-details-v1',
    });
  if (job.kind === 'EXTRACT_COLOR_PALETTE') return 96;
  if (job.kind === 'PURGE_ASSET') return 32;
  return 1400;
}
