import type { TaskPresentation } from './task-engine';
export interface BackgroundSchedule {
  mode: string;
  nightStart: string;
  nightEnd: string;
}
export const DEFAULT_BACKGROUND_SCHEDULE: BackgroundSchedule = {
  mode: 'NIGHT',
  nightStart: '23:00',
  nightEnd: '06:00',
};
const minuteOfDay = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return NaN;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};
const shanghaiMinutes = (now: Date) => (now.getUTCHours() * 60 + now.getUTCMinutes() + 480) % 1440;

export function backgroundScheduleAllows(settings: BackgroundSchedule, now = new Date()): boolean {
  if (settings.mode === 'ALWAYS') return true;
  if (settings.mode !== 'NIGHT') return false;
  const start = minuteOfDay(settings.nightStart),
    end = minuteOfDay(settings.nightEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const current = shanghaiMinutes(now);
  return (
    start === end ||
    (start < end ? current >= start && current < end : current >= start || current < end)
  );
}

export function nextBackgroundTime(settings: BackgroundSchedule, now = new Date()): Date | null {
  if (backgroundScheduleAllows(settings, now)) return now;
  if (settings.mode !== 'NIGHT') return null;
  const start = minuteOfDay(settings.nightStart);
  if (!Number.isFinite(start) || !Number.isFinite(minuteOfDay(settings.nightEnd))) return null;
  const minutes = (start - shanghaiMinutes(now) + 1440) % 1440 || 1440;
  return new Date(
    now.getTime() + minutes * 60000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds(),
  );
}

export const TASK_FAMILIES = [
  'BROWSE',
  'DETAILS',
  'VIDEO',
  'EMBEDDING',
  'FACES',
  'COLOR',
  'PYRAMID',
  'SMART_FOLDERS',
  'TAG_INDEX',
  'PHOTO_MAP',
  'CLEANUP',
  'APPROVALS',
  'UPLOADS',
  'IMPORTS',
] as const;
export type TaskFamily = (typeof TASK_FAMILIES)[number];
export type TaskWaitReason =
  | 'DEPENDENCY'
  | 'DEPENDENCY_FAILED'
  | 'PAUSED'
  | 'SCHEDULE'
  | 'DISABLED'
  | 'WORKER_OFFLINE'
  | 'MODEL_OFFLINE'
  | 'MODEL_DRIFTED'
  | 'RETRY'
  | 'QUEUED'
  | 'APPROVAL';
export interface TaskCounts {
  queued: number;
  running: number;
  failed: number;
  completed: number;
  approval: number;
}
export interface TaskStep extends TaskCounts {
  id: string;
}
export interface TaskGroup extends TaskCounts {
  id: TaskFamily;
  background: boolean;
  presentation?: TaskPresentation;
  availability?: 'ENABLED' | 'DISABLED' | 'UNKNOWN';
  policy?: { paused: boolean; priority: number };
  waiting: Array<{ reason: TaskWaitReason; count: number; nextAt: string | null }>;
  steps: TaskStep[];
}
export const CONTROLLABLE_TASK_FAMILIES = [
  'DETAILS',
  'VIDEO',
  'EMBEDDING',
  'FACES',
  'COLOR',
  'PYRAMID',
  'SMART_FOLDERS',
  'TAG_INDEX',
] as const;
export interface WorkerTaskCapabilities {
  embedding?: 'READY' | 'OFFLINE' | 'DRIFTED';
  background: boolean;
  jobKinds: string[] | null;
  video: boolean;
  tagBuilds: boolean;
  smartFolders: boolean;
  photoMap: boolean;
}
export interface TaskCenterOverview {
  worker: 'ONLINE' | 'OFFLINE';
  embedding?: 'READY' | 'OFFLINE' | 'DRIFTED' | 'UNKNOWN';
  settings: BackgroundSchedule & { timeZone: 'Asia/Shanghai' };
  groups: TaskGroup[];
  refreshedAt: string;
}

/** First match wins. SQL generation consumes this registry rather than copying classifiers. */
export const MEDIA_FAMILY_RULES: ReadonlyArray<{ family: TaskFamily; version?: string; prefix?: string; kind?: string }> = [
  { version: 'photo-source-details-v1', family: 'DETAILS' },
  { prefix: 'video-playback-', family: 'VIDEO' },
  { prefix: 'camera-video-playback-', family: 'VIDEO' },
  { kind: 'GENERATE_EMBEDDING', family: 'EMBEDDING' },
  { kind: 'ANALYZE_PHOTO_FACES', family: 'FACES' },
  { kind: 'EXTRACT_COLOR_PALETTE', family: 'COLOR' },
  { kind: 'GENERATE_IMAGE_PYRAMID', family: 'PYRAMID' },
  { kind: 'PURGE_ASSET', family: 'CLEANUP' },
];
export function mediaTaskFamily(kind: string, version: string): TaskFamily {
  return MEDIA_FAMILY_RULES.find((rule) => rule.version ? version === rule.version
    : rule.prefix ? version.startsWith(rule.prefix) : rule.kind === kind)?.family ?? 'BROWSE';
}

export function isBackgroundFamily(family: TaskFamily): boolean {
  return !['BROWSE', 'UPLOADS', 'IMPORTS', 'CLEANUP', 'APPROVALS', 'PHOTO_MAP'].includes(family);
}

/** Fixed preference within an eligible lane. FIFO turns and lane quotas prevent starvation.
 * Light work using small derived images comes before heavy original decoding.
 * Dependencies, time windows and deployment capabilities always filter first.
 */
export const TASK_EXECUTION_ORDER: readonly TaskFamily[] = [
  'UPLOADS',
  'BROWSE',
  'COLOR',
  'EMBEDDING',
  'SMART_FOLDERS',
  'TAG_INDEX',
  'FACES',
  'DETAILS',
  'VIDEO',
  'PYRAMID',
  'PHOTO_MAP',
  'CLEANUP',
  'IMPORTS',
  'APPROVALS',
];
export const taskExecutionPriority = (family: TaskFamily): number =>
  TASK_EXECUTION_ORDER.length - TASK_EXECUTION_ORDER.indexOf(family);

export type TaskSection = 'IMMEDIATE' | 'SCHEDULED' | 'PAUSED' | 'REVIEW';
export function taskSection(group: TaskGroup, schedule: BackgroundSchedule): TaskSection {
  if (group.presentation) return group.presentation.section;
  if (group.id === 'APPROVALS') return 'REVIEW';
  if (
    group.availability === 'DISABLED' ||
    group.policy?.paused ||
    (group.background && schedule.mode === 'MANUAL') ||
    (group.queued > 0 &&
      group.waiting.some((wait) => wait.reason === 'DISABLED' && wait.count === group.queued))
  )
    return 'PAUSED';
  return group.background && schedule.mode !== 'ALWAYS' ? 'SCHEDULED' : 'IMMEDIATE';
}
