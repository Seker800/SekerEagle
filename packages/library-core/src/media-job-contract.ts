/** Durable protocol values; changing a processor identity invalidates stored work and needs migration review. */
export const PHOTO_SOURCE_DETAILS_PROCESSOR_VERSION = 'photo-source-details-v1';
export const VIDEO_PLAYBACK_PROCESSOR_VERSION = 'camera-video-playback-v1';

export const MEDIA_JOB_KINDS = [
  'RENDER_EDITED_COPY',
  'GENERATE_RENDITIONS',
  'GENERATE_THUMBNAIL',
  'GENERATE_PREVIEW',
  'PROBE_MEDIA',
  'EXTRACT_COLOR_PALETTE',
  'GENERATE_IMAGE_PYRAMID',
  'GENERATE_AI_TAGS', // Historical protocol value; new execution is disabled.
  'GENERATE_EMBEDDING',
  'ANALYZE_PHOTO_FACES',
  'PURGE_ASSET',
] as const;
export type MediaJobKind = (typeof MEDIA_JOB_KINDS)[number];
export type ProcessingLane = 'INTERACTIVE' | 'BACKGROUND' | 'MAINTENANCE';
export type BackgroundProcessingMode = 'ALWAYS' | 'NIGHT' | 'MANUAL';

export const MEDIA_JOB_LANES: Readonly<Record<MediaJobKind, ProcessingLane>> = {
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
export function processingLaneForMediaJob(
  kind: MediaJobKind,
  processorVersion?: string,
): ProcessingLane {
  return kind === 'GENERATE_PREVIEW' && processorVersion === VIDEO_PLAYBACK_PROCESSOR_VERSION
    ? 'BACKGROUND'
    : MEDIA_JOB_LANES[kind];
}
