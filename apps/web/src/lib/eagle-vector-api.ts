import { fetchWithBrowserSession } from './api-client';
import { getEagleRenditionContentUrl } from './eagle-api';

export interface EagleVectorSummary {
  model: string;
  dimensions: number;
  embeddingCoverage: {
    eligible: number;
    ready: number;
    failed: number;
    queued: number;
    running: number;
    missing: number;
    blocked: number;
    processing: number;
    percentage: number;
  };
  processingSchedule: {
    mode: 'ALWAYS' | 'NIGHT' | 'MANUAL';
    nightStart: string;
    nightEnd: string;
    timeZone: 'Asia/Shanghai';
  };
  tags: { enabled: number; ready: number; awaitingCenter: number };
  suggestions: { unclassified: number; pending: number };
  host: {
    status: 'ONLINE' | 'OFFLINE' | 'DRIFTED' | 'NOT_CONFIGURED';
    model?: string | null;
    revision?: string | null;
    dimensions?: number | null;
    metal?: boolean;
  };
  refreshedAt: string;
}

export interface EagleVectorTag {
  id: string;
  name: string;
  color: string | null;
  assetCount: number;
  recommendationEnabled: boolean;
  currentSnapshotId: string | null;
  lastGeneratedAt: string | null;
  activeBuild: { id: string; status: 'PENDING' | 'PROCESSING'; createdAt: string } | null;
  currentSnapshot: {
    id: string;
    version: number;
    sourceAssetCount: number;
    addedMemberCount: number;
    removedMemberCount: number;
    activatedAt: string | null;
    centerCount: number;
  } | null;
  pendingSuggestionCount: number;
}

export interface EagleVectorAssetPreview {
  id: string;
  displayName: string;
  width: number | null;
  height: number | null;
  renditions: Array<{ id: string; width: number | null; height: number | null }>;
}

export interface EagleVectorSuggestion {
  id: string;
  score: number;
  distance: number;
  prototypeRank: number;
  createdAt: string;
  suggestedTag: { id: string; name: string; color: string | null };
  asset: EagleVectorAssetPreview;
}

export interface EagleUnclassifiedAsset extends EagleVectorAssetPreview {
  embeddings: Array<{ status: string; errorCode: string | null }>;
}

export interface EagleTagDistanceAsset {
  assetId: string;
  distance: number;
  prototypeRank: number;
  asset: Omit<EagleVectorAssetPreview, 'renditions'>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithBrowserSession(`/api/eagle/vector/${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
    throw new Error(message ?? `向量服务请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export const getVectorThumbnailUrl = (asset: Pick<EagleVectorAssetPreview, 'id' | 'renditions'>) =>
  asset.renditions[0]
    ? getEagleRenditionContentUrl(asset.id, asset.renditions[0].id, 'THUMBNAIL')
    : null;

export function fetchEagleVectorSummary() {
  return request<EagleVectorSummary>('summary');
}
export function listEagleVectorTags(query?: string) {
  const params = new URLSearchParams();
  if (query?.trim()) params.set('query', query.trim());
  const suffix = params.size ? `?${params}` : '';
  return request<EagleVectorTag[]>(`tags${suffix}`);
}
export function setEagleVectorTagEnabled(tagId: string, recommendationEnabled: boolean) {
  return request(`tags/${encodeURIComponent(tagId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ recommendationEnabled }),
  });
}
export function rebuildEagleVectorTag(tagId: string) {
  return request(`tags/${encodeURIComponent(tagId)}/rebuild`, { method: 'POST', body: '{}' });
}
export function listEagleVectorSuggestions(tagId?: string, cursor?: string) {
  const query = new URLSearchParams({ limit: '40', sort: 'SCORE_DESC' });
  if (tagId) query.set('tagId', tagId);
  if (cursor) query.set('cursor', cursor);
  return request<{ items: EagleVectorSuggestion[]; nextCursor: string | null }>(
    `suggestions?${query}`,
  );
}
export function reviewEagleVectorSuggestions(suggestionIds: string[], action: 'ACCEPT' | 'REJECT') {
  return request<{ items: Array<{ id: string; status: string; assetId: string }> }>(
    'suggestions/review-batch',
    { method: 'POST', body: JSON.stringify({ suggestionIds, action }) },
  );
}
export function listEagleUnclassifiedAssets(cursor?: string) {
  const query = new URLSearchParams({ limit: '40' });
  if (cursor) query.set('cursor', cursor);
  return request<{ items: EagleUnclassifiedAsset[]; nextCursor: string | null }>(
    `unclassified?${query}`,
  );
}
export function retryFailedEagleEmbeddings() {
  return request<{ retried: number }>('embeddings/retry-failed', { method: 'POST', body: '{}' });
}
export function scanMissingEagleEmbeddings() {
  return request<{ scanned: number; created: number; repaired: number }>(
    'embeddings/scan-missing',
    {
      method: 'POST',
      body: '{}',
    },
  );
}
export function scanUnclassifiedEagleSuggestions() {
  return request<{ scanned: number; matched: number }>('suggestions/scan-unclassified', {
    method: 'POST',
    body: '{}',
  });
}
export function listEagleTagDistanceAssets(
  tagId: string,
  direction: 'ASC' | 'DESC',
  cursor?: string,
) {
  const query = new URLSearchParams({ limit: '40', direction });
  if (cursor) query.set('cursor', cursor);
  return request<{ items: EagleTagDistanceAsset[]; nextCursor: string | null }>(
    `tags/${encodeURIComponent(tagId)}/assets?${query}`,
  );
}
