export { VIDEO_PLAYBACK_PROCESSOR_VERSION } from '@sekereagle/library-core';
export function videoProcessingStage(
  kind: string,
  transcoding: boolean,
): 'POSTER' | 'PLAYBACK' | 'FULL' {
  return kind === 'GENERATE_PREVIEW' ? 'PLAYBACK' : transcoding ? 'FULL' : 'POSTER';
}
export function videoTranscodingEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('EAGLE_VIDEO_TRANSCODING_ENABLED must be true or false');
}
