export type EagleBackgroundProcessingMode = 'ALWAYS' | 'NIGHT' | 'MANUAL';
export type EagleMediaJobKind =
  | 'GENERATE_RENDITIONS'
  | 'GENERATE_THUMBNAIL'
  | 'GENERATE_PREVIEW'
  | 'PROBE_MEDIA'
  | 'EXTRACT_COLOR_PALETTE'
  | 'GENERATE_IMAGE_PYRAMID'
  | 'GENERATE_EMBEDDING'
  | 'GENERATE_AI_TAGS'
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
  GENERATE_RENDITIONS: 'INTERACTIVE',
  GENERATE_THUMBNAIL: 'INTERACTIVE',
  GENERATE_PREVIEW: 'INTERACTIVE',
  PROBE_MEDIA: 'INTERACTIVE',
  EXTRACT_COLOR_PALETTE: 'BACKGROUND',
  GENERATE_IMAGE_PYRAMID: 'BACKGROUND',
  GENERATE_EMBEDDING: 'BACKGROUND',
  GENERATE_AI_TAGS: 'BACKGROUND',
  PURGE_ASSET: 'MAINTENANCE',
};

export const ASSET_READY_BLOCKING_JOB_KINDS: readonly EagleMediaJobKind[] = [
  'GENERATE_RENDITIONS',
  'GENERATE_THUMBNAIL',
  'GENERATE_PREVIEW',
  'PROBE_MEDIA',
] as const;

const ASSET_READY_BLOCKING_KINDS = new Set<EagleMediaJobKind>(ASSET_READY_BLOCKING_JOB_KINDS);

export function processingLaneForKind(kind: EagleMediaJobKind): EagleProcessingLane {
  return LANE_BY_KIND[kind];
}

export function taskBlocksAssetReady(kind: EagleMediaJobKind): boolean {
  return ASSET_READY_BLOCKING_KINDS.has(kind);
}

function minuteOfDay(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function shanghaiMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hours * 60 + minutes;
}

export function canClaimBackgroundJobs(
  mode: EagleBackgroundProcessingMode,
  windowStart: string,
  windowEnd: string,
  now = new Date(),
): boolean {
  if (mode === 'ALWAYS') return true;
  if (mode === 'MANUAL') return false;
  const current = shanghaiMinuteOfDay(now);
  const start = minuteOfDay(windowStart);
  const end = minuteOfDay(windowEnd);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function canClaimAiTagJobs(
  manualEnabled: boolean,
  scheduleEnabled: boolean,
  windowStart: string,
  windowEnd: string,
  now = new Date(),
): boolean {
  if (manualEnabled) return true;
  if (!scheduleEnabled) return false;
  return canClaimBackgroundJobs('NIGHT', windowStart, windowEnd, now);
}
