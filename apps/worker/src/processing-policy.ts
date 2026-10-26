import { VIDEO_PLAYBACK_PROCESSOR_VERSION } from './video-processing-policy';
import {
  backgroundScheduleAllows,
  MEDIA_BROWSE_BLOCKING_KINDS,
  mediaTaskBlocksAssetReady,
  DEFAULT_BACKGROUND_SCHEDULE,
  type BackgroundSchedule,
} from '@sekereagle/library-core';
export type EagleBackgroundProcessingMode = 'ALWAYS' | 'NIGHT' | 'MANUAL';
export type EagleMediaJobKind =
  | 'RENDER_EDITED_COPY'
  | 'GENERATE_RENDITIONS'
  | 'GENERATE_THUMBNAIL'
  | 'GENERATE_PREVIEW'
  | 'PROBE_MEDIA'
  | 'EXTRACT_COLOR_PALETTE'
  | 'GENERATE_IMAGE_PYRAMID'
  | 'GENERATE_AI_TAGS' // Historical rows only; never selected or executed.
  | 'GENERATE_EMBEDDING'
  | 'ANALYZE_PHOTO_FACES'
  | 'PURGE_ASSET';
export type EagleProcessingLane = 'INTERACTIVE' | 'BACKGROUND' | 'MAINTENANCE';

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

const LANE_BY_KIND: Record<EagleMediaJobKind, EagleProcessingLane> = {
  RENDER_EDITED_COPY: 'INTERACTIVE',
  GENERATE_RENDITIONS: 'INTERACTIVE',
  GENERATE_THUMBNAIL: 'INTERACTIVE',
  GENERATE_PREVIEW: 'INTERACTIVE',
  PROBE_MEDIA: 'INTERACTIVE',
  EXTRACT_COLOR_PALETTE: 'BACKGROUND',
  GENERATE_IMAGE_PYRAMID: 'BACKGROUND',
  GENERATE_AI_TAGS: 'BACKGROUND',
  GENERATE_EMBEDDING: 'BACKGROUND',
  ANALYZE_PHOTO_FACES: 'BACKGROUND',
  PURGE_ASSET: 'MAINTENANCE',
};

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

export const ASSET_READY_BLOCKING_JOB_KINDS: readonly EagleMediaJobKind[] = MEDIA_BROWSE_BLOCKING_KINDS;

export function processingLaneForKind(
  kind: EagleMediaJobKind,
  processorVersion?: string,
): EagleProcessingLane {
  return kind === 'GENERATE_PREVIEW' && processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION
    ? 'BACKGROUND'
    : LANE_BY_KIND[kind];
}

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
  if (processorVersion === 'photo-source-details-v1')
    return { mediaErrorCode: 'PHOTO_SOURCE_DETAILS_FAILED' };
  if (kind === 'GENERATE_PREVIEW' && processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION)
    return { mediaErrorCode: 'VIDEO_PLAYBACK_FAILED' };
  return taskBlocksAssetReady(kind, processorVersion)
    ? { lifecycleStatus: 'FAILED', mediaErrorCode: message.slice(0, 100) }
    : null;
}
