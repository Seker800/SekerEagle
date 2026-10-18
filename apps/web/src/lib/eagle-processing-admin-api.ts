import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { fetchWithBrowserSession } from './api-client';

import { errorFromResponse } from './api-error';

export type EagleProcessingLane = 'INTERACTIVE' | 'BACKGROUND' | 'MAINTENANCE';

export type EagleProcessingStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type EagleProcessingMode = 'ALWAYS' | 'NIGHT' | 'MANUAL';

export interface EagleProcessingSettings {
  mode: EagleProcessingMode;
  nightStart: string;
  nightEnd: string;
  timeZone: 'Asia/Shanghai';
}

export interface EagleProcessingSummary {
  worker: {
    status: 'ONLINE' | 'OFFLINE';
    count: number;
    activeJobCount: number;
    lastHeartbeatAt: string | null;
    version: string | null;
  };
  counts: {
    running: number;
    queued: number;
    failed: number;
    completedLast24Hours: number;
  };
  queues: Array<{
    lane: EagleProcessingLane;
    queued: number;
    running: number;
    failed: number;
  }>;
  colorCoverage: {
    processorVersion: string;
    eligible: number;
    completed: number;
    processing: number;
    failed: number;
    percentage: number;
  };
  settings: EagleProcessingSettings;
  refreshedAt: string;
}

export interface EagleProcessingJob {
  id: string;
  assetReference: string;
  kind: string;
  lane: EagleProcessingLane;
  status: EagleProcessingStatus;
  processorVersion: string;
  attempts: number;
  availableAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export function createEagleProcessingAdminApi(libraryMode: LibraryMode = 'MATERIAL') {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchWithBrowserSession(
      libraryApiPath(`/api/admin/eagle-processing/${path}`, libraryMode),
      {
        ...init,
        headers: init?.body
          ? { 'content-type': 'application/json', ...init.headers }
          : init?.headers,
      },
    );
    if (!response.ok) {
      throw await errorFromResponse(response, '读取处理状态失败（{{value1}}）');
    }
    return response.json() as Promise<T>;
  }

  function fetchEagleProcessingSummary(_token: string) {
    return request<EagleProcessingSummary>('summary');
  }

  function listEagleProcessingJobs(
    _token: string,
    filters: {
      status?: string;
      lane?: string;
      kind?: string;
      cursor?: string;
      limit?: number;
    } = {},
  ) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) query.set(key, String(value));
    });
    const queryString = query.toString();
    return request<{
      items: EagleProcessingJob[];
      nextCursor: string | null;
    }>(queryString ? `jobs?${queryString}` : 'jobs');
  }

  function retryEagleProcessingJob(_token: string, id: string) {
    return request<{
      retried: number;
    }>(`jobs/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
      body: '{}',
    });
  }

  function retryAllFailedEagleProcessingJobs(_token: string) {
    return request<{
      retried: number;
    }>('retry-failed', { method: 'POST', body: '{}' });
  }

  function reconcileEagleProcessingJobs(_token: string) {
    return request<{
      scanned: number;
      created: number;
      skipped: number;
      remaining: number;
    }>('reconcile', { method: 'POST', body: '{}' });
  }

  function updateEagleProcessingSettings(
    _token: string,
    settings: Pick<EagleProcessingSettings, 'mode' | 'nightStart' | 'nightEnd'>,
  ) {
    return request<EagleProcessingSettings>('settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  }
  return {
    fetchEagleProcessingSummary,
    listEagleProcessingJobs,
    retryEagleProcessingJob,
    retryAllFailedEagleProcessingJobs,
    reconcileEagleProcessingJobs,
    updateEagleProcessingSettings,
  };
}
export const {
  fetchEagleProcessingSummary,
  listEagleProcessingJobs,
  retryEagleProcessingJob,
  retryAllFailedEagleProcessingJobs,
  reconcileEagleProcessingJobs,
  updateEagleProcessingSettings,
} = createEagleProcessingAdminApi();
