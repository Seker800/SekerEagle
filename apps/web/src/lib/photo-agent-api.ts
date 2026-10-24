import { t } from '../i18n';
import { request } from './api-client';
export interface PhotoCity {
  id: string;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
  precision?: 'CITY' | 'EXACT';
  accuracyMeters?: number;
}
export interface AgentPhoto {
  id: string;
  displayName: string;
  originalName: string;
  mediaRevision: number;
  rowVersion: number;
  deletedAt: string | null;
  previewId?: string | null;
  filenameSignals?: string[];
}
export interface PhotoAgentSuggestion {
  id: string;
  assetId: string;
  kind: 'CITY' | 'NON_PHOTO' | 'SEND_TO_MATERIAL' | 'DELETE';
  status: 'PENDING' | 'APPLYING' | 'FAILED' | 'ACCEPTED' | 'REJECTED' | 'UNDONE';
  value: PhotoCity | { category: string };
  rationale: string;
  evidence: Array<{ id: string }>;
}
export interface PhotoAgentTaskSummary {
  id: string;
  kind: 'CITY' | 'NON_PHOTO' | 'SEND_TO_MATERIAL' | 'DELETE';
  status: 'OPEN' | 'CANCELLED';
  expiresAt: string | null;
  title?: string | null;
  rationale?: string | null;
  createdAt?: string;
  pendingCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  retryCount?: number;
  coverIds?: string[];
  assetCount: number;
}
export interface PhotoAgentTask extends Omit<PhotoAgentTaskSummary, 'assetCount'> {
  assets: AgentPhoto[];
  suggestions: PhotoAgentSuggestion[];
}
const base = '/api/photos/agent';
export const listPhotoAgentTasks = (after?: string, signal?: AbortSignal) =>
  request<{ items: PhotoAgentTaskSummary[]; next: string | null }>(
    `${base}/tasks?limit=20${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    { signal },
  );
export const getPhotoAgentTask = (id: string, signal?: AbortSignal) =>
  request<PhotoAgentTask>(`${base}/tasks/${encodeURIComponent(id)}`, { signal });
export const reviewPhotoAgentSuggestion = (
  taskId: string,
  id: string,
  action: 'ACCEPT' | 'REJECT',
  city?: PhotoCity,
) =>
  request(
    `${base}/tasks/${encodeURIComponent(taskId)}/suggestions/${encodeURIComponent(id)}/review`,
    { method: 'POST', body: JSON.stringify({ action, ...(city ? { city } : {}) }) },
  );
export const undoPhotoAgentSuggestion = (taskId: string, id: string) =>
  request(
    `${base}/tasks/${encodeURIComponent(taskId)}/suggestions/${encodeURIComponent(id)}/undo`,
    { method: 'POST', body: '{}' },
  );
export const cancelPhotoAgentTask = (id: string) =>
  request(`${base}/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
export async function createPhotoAgentTask(from: string, to: string, kind: 'CITY' | 'NON_PHOTO') {
  const query = new URLSearchParams({ from, to, limit: '100' });
  const first = await request<{ items: AgentPhoto[]; next: string | null }>(
    `${base}/photos?${query}`,
  );
  let items = first.items;
  if (first.next) {
    query.set('after', first.next);
    const second = await request<{ items: AgentPhoto[]; next: string | null }>(
      `${base}/photos?${query}`,
    );
    if (second.next) throw new Error(t('范围超过 200 张，请缩小日期范围。'));
    items = items.concat(second.items);
  }
  return request<{ id: string }>(`${base}/tasks`, {
    method: 'POST',
    body: JSON.stringify({ kind, assetIds: items.map((a) => a.id) }),
  });
}

export interface PhotoRequestReviewResult {
  results: Array<{ id: string; status: string; error?: string }>;
  succeeded: number;
  failed: number;
}
export const reviewPhotoRequest = (
  taskId: string,
  suggestionIds: string[],
  action: 'ACCEPT' | 'REJECT',
) =>
  request<PhotoRequestReviewResult>(`${base}/tasks/${encodeURIComponent(taskId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ suggestionIds, action }),
  });

export interface PhotoAgentEvent {
  id: string;
  suggestionId: string | null;
  assetId: string | null;
  actor: 'AGENT' | 'HUMAN' | 'SYSTEM';
  action:
    | 'PROPOSED'
    | 'REJECTED'
    | 'EXECUTED'
    | 'EXECUTION_STARTED'
    | 'EXECUTION_FAILED'
    | 'UNDONE'
    | 'CANCELLED'
    | 'REVIEW_FAILED'
    | 'UNDO_FAILED';
  createdAt: string;
  details: {
    kind?: string;
    legacySnapshot?: boolean;
    value?: PhotoCity;
    error?: string;
    previousStatus?: string;
  };
}
export const getPhotoAgentHistory = (taskId: string, after?: string, signal?: AbortSignal) =>
  request<{ items: PhotoAgentEvent[]; next: string | null }>(
    `${base}/tasks/${encodeURIComponent(taskId)}/history?limit=20${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    { signal },
  );
