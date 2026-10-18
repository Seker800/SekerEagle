import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { fetchWithBrowserSession } from './api-client';

import { errorFromResponse } from './api-error';

export interface EagleAiTagSummary {
  eligible: number;
  analyzed: number;
  queued: number;
  running: number;
  failed: number;
  tags: number;
  ollama: {
    status: 'ONLINE' | 'OFFLINE' | 'MODEL_MISSING';
    model: string;
  };
  settings: EagleAiTagSettings;
}

export interface EagleAiTagSettings {
  manualEnabled: boolean;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timeZone: 'Asia/Shanghai';
}
export function createEagleAiTagApi(libraryMode: LibraryMode = 'MATERIAL') {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchWithBrowserSession(
      libraryApiPath(`/api/eagle/ai-tags${path}`, libraryMode),
      init,
    );
    if (!response.ok) {
      throw await errorFromResponse(response, '请求失败（{{value1}}）');
    }
    return response.json() as Promise<T>;
  }

  function fetchEagleAiTagSummary() {
    return request<EagleAiTagSummary>('/summary');
  }

  function scanMissingEagleAiTags() {
    return request<{
      created: number;
    }>('/scan-missing', { method: 'POST' });
  }

  function retryFailedEagleAiTags() {
    return request<{
      retried: number;
    }>('/retry-failed', { method: 'POST' });
  }

  function updateEagleAiTagSettings(settings: Omit<EagleAiTagSettings, 'timeZone'>) {
    return request<EagleAiTagSettings>('/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });
  }
  return {
    fetchEagleAiTagSummary,
    scanMissingEagleAiTags,
    retryFailedEagleAiTags,
    updateEagleAiTagSettings,
  };
}
export const {
  fetchEagleAiTagSummary,
  scanMissingEagleAiTags,
  retryFailedEagleAiTags,
  updateEagleAiTagSettings,
} = createEagleAiTagApi();
