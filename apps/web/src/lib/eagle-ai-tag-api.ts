import { fetchWithBrowserSession } from './api-client';

export interface EagleAiTagSummary {
  eligible: number;
  analyzed: number;
  queued: number;
  running: number;
  failed: number;
  tags: number;
  ollama: { status: 'ONLINE' | 'OFFLINE' | 'MODEL_MISSING'; model: string };
  settings: EagleAiTagSettings;
}

export interface EagleAiTagSettings {
  manualEnabled: boolean;
  scheduleEnabled: boolean;
  scheduleStart: string;
  scheduleEnd: string;
  timeZone: 'Asia/Shanghai';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithBrowserSession(`/api/eagle/ai-tags${path}`, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? `请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export function fetchEagleAiTagSummary() {
  return request<EagleAiTagSummary>('/summary');
}

export function scanMissingEagleAiTags() {
  return request<{ created: number }>('/scan-missing', { method: 'POST' });
}

export function retryFailedEagleAiTags() {
  return request<{ retried: number }>('/retry-failed', { method: 'POST' });
}

export function updateEagleAiTagSettings(settings: Omit<EagleAiTagSettings, 'timeZone'>) {
  return request<EagleAiTagSettings>('/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
