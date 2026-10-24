import type { BackgroundSchedule, TaskCenterOverview, TaskFamily } from '@sekereagle/library-core';
import { fetchWithBrowserSession } from './api-client';
import { errorFromResponse } from './api-error';
import { libraryApiPath, type LibraryMode } from './library-api-scope';

export function createEagleTaskCenterApi(libraryMode: LibraryMode = 'MATERIAL') {
  async function request<T>(suffix = '', init?: RequestInit): Promise<T> {
    const response = await fetchWithBrowserSession(
      libraryApiPath(`/api/eagle/tasks${suffix}`, libraryMode),
      init,
    );
    if (!response.ok) throw await errorFromResponse(response, '读取任务中心失败（{{value1}}）');
    return response.json() as Promise<T>;
  }
  return {
    updateEagleTaskPolicy: (policy: { family: TaskFamily; paused: boolean; priority?: number }) =>
      request<{ family: TaskFamily; paused: boolean; priority: number }>('/policy', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(policy),
      }),
    fetchEagleTaskCenter: (signal?: AbortSignal) => request<TaskCenterOverview>('', { signal }),
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
  updateEagleTaskSchedule,
  retryEagleTaskFamily,
  updateEagleTaskPolicy,
} = createEagleTaskCenterApi();
