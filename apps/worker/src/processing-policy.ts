import {
  PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION,
  VIDEO_PLAYBACK_PROCESSOR_VERSION,
} from '@sekereagle/library-core';
import {
  MEDIA_JOB_LANES as LANE_BY_KIND,
  processingLaneForMediaJob,
  type MediaJobKind,
  type ProcessingLane,
  type BackgroundProcessingMode,
} from '@sekereagle/library-core';
import {
  backgroundScheduleAllows,
  MEDIA_BROWSE_BLOCKING_KINDS,
  mediaTaskBlocksAssetReady,
  DEFAULT_BACKGROUND_SCHEDULE,
  type BackgroundSchedule,
} from '@sekereagle/library-core';
export type EagleBackgroundProcessingMode = BackgroundProcessingMode;
export type EagleMediaJobKind = MediaJobKind;
export type EagleProcessingLane = ProcessingLane;

export interface ClaimedEagleMediaJob {
  id: string;
  ownerId: string;
  assetId: string;
  kind: EagleMediaJobKind;
  lane: EagleProcessingLane;
  processorVersion: string;
  assetRevision: number;
  attempts: number;
  leaseVersion: number;
}

/** Optional deployment profile. Invalid or empty selections fail closed at startup. */
export function parseProcessingJobKinds(
  value: string | undefined,
): readonly EagleMediaJobKind[] | undefined {
  if (value === undefined) return undefined;
  const kinds = value.split(',').map((kind) => kind.trim());
  if (
    !kinds.length ||
    kinds.some((kind) => kind === 'GENERATE_AI_TAGS' || !Object.hasOwn(LANE_BY_KIND, kind))
  )
    throw new Error('EAGLE_PROCESSING_JOB_KINDS must contain supported, nonempty job kinds');
  return Object.freeze([...new Set(kinds as EagleMediaJobKind[])]);
}

/** Missing optional models leave work queued, instead of consuming retries. */
export function availableProcessingJobKinds(
  configured: readonly EagleMediaJobKind[] | undefined,
  facesConfigured: boolean,
): readonly EagleMediaJobKind[] | undefined {
  if (facesConfigured) return configured;
  const kinds = configured ?? (Object.keys(LANE_BY_KIND) as EagleMediaJobKind[]);
  return kinds.filter((kind) => kind !== 'ANALYZE_PHOTO_FACES' && kind !== 'GENERATE_AI_TAGS');
}

export const ASSET_READY_BLOCKING_JOB_KINDS: readonly EagleMediaJobKind[] =
  MEDIA_BROWSE_BLOCKING_KINDS;

export const processingLaneForKind = processingLaneForMediaJob;

export function taskBlocksAssetReady(kind: EagleMediaJobKind, processorVersion?: string): boolean {
  return mediaTaskBlocksAssetReady(kind, processorVersion);
}

export function canClaimBackgroundJobs(
  mode: EagleBackgroundProcessingMode,
  windowStart: string,
  windowEnd: string,
  now = new Date(),
): boolean {
  return backgroundScheduleAllows({ mode, nightStart: windowStart, nightEnd: windowEnd }, now);
}

export function mediaBackgroundAllowed(
  settings: BackgroundSchedule | null,
  kind: string,
  now = new Date(),
): boolean {
  return (
    kind !== 'GENERATE_AI_TAGS' &&
    backgroundScheduleAllows(settings ?? DEFAULT_BACKGROUND_SCHEDULE, now)
  );
}

/** An import-only worker can pause optional analysis without changing owner preferences. */
export function backgroundProcessingEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('EAGLE_BACKGROUND_PROCESSING_ENABLED must be true or false');
}

export function terminalAssetFailure(
  kind: EagleMediaJobKind,
  processorVersion: string,
  message: string,
): { lifecycleStatus?: 'FAILED'; mediaErrorCode: string } | null {
  if (processorVersion === PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION)
    return { mediaErrorCode: 'PHOTO_SOURCE_DETAILS_FAILED' };
  if (kind === 'GENERATE_PREVIEW' && processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION)
    return { mediaErrorCode: 'VIDEO_PLAYBACK_FAILED' };
  return taskBlocksAssetReady(kind, processorVersion)
    ? { lifecycleStatus: 'FAILED', mediaErrorCode: message.slice(0, 100) }
    : null;
}
