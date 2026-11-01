import type {
  BackgroundSchedule,
  TaskCenterOverview,
  TaskFamily,
  TaskTransitionEvent,
} from '@sekereagle/library-core';
import { request as requestJson } from './api-client';
import { libraryApiPath, type LibraryMode } from './library-api-scope';

export function createEagleTaskCenterApi(libraryMode: LibraryMode = 'MATERIAL') {
  async function request<T>(suffix = '', init?: RequestInit, timeoutMs?: number): Promise<T> {
    return requestJson<T>(
      libraryApiPath(`/api/eagle/tasks${suffix}`, libraryMode),
      init,
      timeoutMs,
      '读取任务中心失败（{{value1}}）',
    );
  }
  return {
    updateEagleTaskPolicy: (policy: { family: TaskFamily; paused: boolean; priority?: number }) =>
      request<{ family: TaskFamily; paused: boolean; priority: number }>('/policy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      }),
    startEagleTaskFamily: (family: TaskFamily) =>
      request<{ queued: number }>(
        '/start',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ family }),
        },
        690_000,
      ),
    fetchEagleTaskCenter: (signal?: AbortSignal) => request<TaskCenterOverview>('', { signal }),
    fetchEagleTaskHistory: (signal?: AbortSignal) =>
      request<TaskCenterOverview>('/history', { signal }),
    fetchEagleTaskEvents: (family: TaskFamily, signal?: AbortSignal) =>
      request<TaskTransitionEvent[]>(`/events?family=${encodeURIComponent(family)}`, { signal }),
    updateEagleTaskSchedule: (settings: BackgroundSchedule) =>
      request<TaskCenterOverview['settings']>('/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: settings.mode,
          nightStart: settings.nightStart,
          nightEnd: settings.nightEnd,
        }),
      }),
    retryEagleTaskFamily: (family: TaskFamily) =>
      request<{ retried: number }>('/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ family }),
      }),
  };
}
export const {
  fetchEagleTaskCenter,
  startEagleTaskFamily,
  fetchEagleTaskHistory,
  fetchEagleTaskEvents,
  updateEagleTaskSchedule,
  retryEagleTaskFamily,
  updateEagleTaskPolicy,
} = createEagleTaskCenterApi();
