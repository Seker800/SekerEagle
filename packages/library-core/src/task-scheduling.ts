export interface BackgroundSchedule {
  mode: string;
  nightStart: string;
  nightEnd: string;
}
export interface AnalysisSchedule extends BackgroundSchedule {
  aiTagManualEnabled?: boolean;
  aiTagScheduleEnabled?: boolean;
  aiTagScheduleStart?: string;
  aiTagScheduleEnd?: string;
}
/** Earliest point inside both daily windows; disjoint windows have no eligible time. */
export function nextAnalysisTime(
  settings: AnalysisSchedule,
  kind: string,
  dueAt = new Date(),
): Date | null {
  if (kind !== 'GENERATE_AI_TAGS' || settings.aiTagManualEnabled)
    return nextBackgroundTime(settings, dueAt);
  if (!settings.aiTagScheduleEnabled) return null;
  const ai = {
    mode: 'NIGHT',
    nightStart: settings.aiTagScheduleStart ?? '23:00',
    nightEnd: settings.aiTagScheduleEnd ?? '06:00',
  };
  let at = dueAt;
  for (let attempt = 0; attempt < 6; attempt++) {
    const globalAt = nextBackgroundTime(settings, at);
    if (!globalAt) return null;
    const aiAt = nextBackgroundTime(ai, globalAt);
    if (!aiAt) return null;
    if (aiAt.getTime() === globalAt.getTime()) return aiAt;
    at = aiAt;
  }
  return null;
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
  'AI_TAGS',
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
  policy?: { paused: boolean; priority: number };
  waiting: Array<{ reason: TaskWaitReason; count: number; nextAt: string | null }>;
  steps: TaskStep[];
}
export const CONTROLLABLE_TASK_FAMILIES = [
  'DETAILS',
  'VIDEO',
  'EMBEDDING',
  'AI_TAGS',
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
  settings: BackgroundSchedule & { timeZone: 'Asia/Shanghai' };
  groups: TaskGroup[];
  refreshedAt: string;
}

export function mediaTaskFamily(kind: string, version: string): TaskFamily {
  if (version === 'photo-source-details-v1') return 'DETAILS';
  if (version.startsWith('video-playback-')) return 'VIDEO';
  const families: Record<string, TaskFamily> = {
    GENERATE_EMBEDDING: 'EMBEDDING',
    GENERATE_AI_TAGS: 'AI_TAGS',
    ANALYZE_PHOTO_FACES: 'FACES',
    EXTRACT_COLOR_PALETTE: 'COLOR',
    GENERATE_IMAGE_PYRAMID: 'PYRAMID',
    PURGE_ASSET: 'CLEANUP',
  };
  return families[kind] ?? 'BROWSE';
}

export function isBackgroundFamily(family: TaskFamily): boolean {
  return !['BROWSE', 'UPLOADS', 'IMPORTS', 'CLEANUP', 'APPROVALS', 'PHOTO_MAP'].includes(family);
}
