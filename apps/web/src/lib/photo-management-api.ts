import { request } from './api-client';
import type { EagleAssetListItem } from './eagle-api';
export interface PhotoFace {
  id: string;
  box: number[];
  confidence: number;
  assetId: string;
  asset: EagleAssetListItem;
}
export interface PhotoPerson {
  id: string;
  name: string | null;
  rowVersion: number;
  faces: PhotoFace[];
}
export interface PhotoGroup {
  id: string;
  kind: 'BURST' | 'SIMILAR' | 'MANUAL';
  bestAssetId: string | null;
  bestSelectedByUser: boolean;
  members: Array<{ asset: EagleAssetListItem }>;
}
const base = '/api/photos/photography';
export const getPhotoFacets = () =>
  request<{ cameras: string[]; lenses: string[] }>(`${base}/facets`);
export const listPhotoPeople = () =>
  request<{ runtimeConfigured: boolean; people: PhotoPerson[] }>(`${base}/people`);
export const scanPhotoPeople = () =>
  request<{ queued: number; scanned: number; limit: number }>(`${base}/people/scan`, {
    method: 'POST',
    body: '{}',
  });
export const renamePhotoPerson = (id: string, name: string) =>
  request(`${base}/people/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
export const mergePhotoPeople = (id: string, targetId: string) =>
  request(`${base}/people/${encodeURIComponent(id)}/merge`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
  });
export const splitPhotoFace = (id: string) =>
  request(`${base}/faces/${encodeURIComponent(id)}/person`, {
    method: 'PATCH',
    body: JSON.stringify({ personId: null }),
  });
export const listPhotoGroups = () => request<PhotoGroup[]>(`${base}/groups`);
export const scanPhotoGroups = () =>
  request<{ created: number; scanned: number; limit: number }>(`${base}/groups/scan`, {
    method: 'POST',
    body: '{}',
  });
export const updatePhotoGroup = (
  id: string,
  input: { bestAssetId?: string; dismissed?: boolean },
) =>
  request(`${base}/groups/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const createPhotoGroup = (assetIds: readonly string[]) =>
  request(`${base}/groups/manual`, { method: 'POST', body: JSON.stringify({ assetIds }) });
export const removePhotoGroupMembers = (id: string, assetIds: string[]) =>
  request(`${base}/groups/${encodeURIComponent(id)}/members`, {
    method: 'PATCH',
    body: JSON.stringify({ assetIds }),
  });
export const mergePhotoGroups = (id: string, targetId: string) =>
  request(`${base}/groups/${encodeURIComponent(id)}/merge`, {
    method: 'POST',
    body: JSON.stringify({ targetId }),
  });

export interface PhotoTimelineMonth {
  month: string;
  count: number;
  cursor: string;
}
export const getPhotoTimeline = (signal?: AbortSignal) =>
  request<{ months: PhotoTimelineMonth[] }>(`${base}/timeline`, { signal });
