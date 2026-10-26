import type { EagleAssetProcessingJob } from '@prisma/client';
import type { MediaResource } from './media-resource-pool';
/** Conservative in-flight reservations for the existing 2 GiB NAS worker.
 * Leave 512 MiB for runtime/maintenance. This is not a hard bound on a codec's RSS.
 */
export const WORKER_INFLIGHT_MEMORY_MIB = 1536;
export function mediaMemoryMiB(
  resource: MediaResource,
  job: Pick<EagleAssetProcessingJob, 'kind'>,
) {
  if (resource === 'EMBEDDING') return 64;
  if (job.kind === 'ANALYZE_PHOTO_FACES') return 384;
  if (resource === 'REMOTE_MEDIA') return 768;
  if (job.kind === 'EXTRACT_COLOR_PALETTE') return 96;
  if (job.kind === 'PURGE_ASSET') return 32;
  return 1400;
}
