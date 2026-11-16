import type { EagleAssetProcessingJob } from '@prisma/client';
import type { MediaJobKind } from '@sekereagle/library-core';
import { editedCopyJob } from './edited-copy-job';
import { assetJob } from './media-job';
import { purgeJob } from './purge-job';
import type { JobHandler, MediaJobContext } from './types';

const early = (handler: JobHandler) => ({ phase: 'EARLY' as const, handler });
const asset = (handler: JobHandler) => ({ phase: 'ASSET' as const, handler });
type JobRoute = ReturnType<typeof early> | ReturnType<typeof asset>;

/**
 * Record<MediaJobKind, ...> is intentional: adding a protocol kind without a
 * route is a TypeScript error, not a runtime surprise in the worker loop.
 */
export const MEDIA_JOB_ROUTES: Record<MediaJobKind, JobRoute> = {
  RENDER_EDITED_COPY: early(editedCopyJob),
  PURGE_ASSET: early(purgeJob),
  ANALYZE_PHOTO_FACES: asset(assetJob),
  GENERATE_RENDITIONS: asset(assetJob),
  GENERATE_THUMBNAIL: asset(assetJob),
  GENERATE_PREVIEW: asset(assetJob),
  PROBE_MEDIA: asset(assetJob),
  EXTRACT_COLOR_PALETTE: asset(assetJob),
  GENERATE_IMAGE_PYRAMID: asset(assetJob),
  GENERATE_EMBEDDING: asset(assetJob),
  GENERATE_AI_TAGS: asset(assetJob),
};

export async function processJob(
  job: EagleAssetProcessingJob,
  remoteRequired: boolean,
  context: MediaJobContext,
): Promise<void> {
  const route = MEDIA_JOB_ROUTES[job.kind];
  if (!route) throw new Error(`UNREGISTERED_MEDIA_JOB_KIND:${job.kind}`);
  await route.handler({ job, remoteRequired, context });
}
