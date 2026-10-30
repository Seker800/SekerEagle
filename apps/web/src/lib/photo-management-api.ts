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
  marksAssetsPrivate: boolean;
  faces: PhotoFace[];
}
export interface PhotoPeopleReviewPair {
  first: PhotoPerson & { photoCount: number };
  second: PhotoPerson & { photoCount: number };
  similarity: number;
}
export const reviewPhotoPeople = (signal?: AbortSignal) =>
  request<{ pairs: PhotoPeopleReviewPair[] }>('/api/photos/photography/people/review-priority', {
    signal,
  });

export interface PhotoGroup {
  id: string;
  kind: 'BURST' | 'SIMILAR' | 'MANUAL' | 'EDITED';
  bestAssetId: string | null;
  bestSelectedByUser: boolean;
  members: Array<{ asset: EagleAssetListItem }>;
}
const base = '/api/photos/photography';
export const getPhotoFacets = () =>
  request<{ cameras: string[]; lenses: string[] }>(`${base}/facets`);
export const listPhotoPeople = (
  after?: string,
  signal?: AbortSignal,
  view: 'ALL' | 'NAMED' | 'UNNAMED' = 'ALL',
) =>
  request<{ runtimeConfigured: boolean; people: PhotoPerson[]; nextCursor: string | null }>(
    `${base}/people?view=${view}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    { signal },
  );
export const scanPhotoPeople = () =>
  request<{ queued: number; scanned: number; limit: number | null }>(
    `${base}/people/scan`,
    {
      method: 'POST',
      body: '{}',
    },
    690_000,
  );
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

export const updatePhotoPersonPrivacy = (
  person: Pick<PhotoPerson, 'id' | 'rowVersion'>,
  marksAssetsPrivate: boolean,
) =>
  request<{ id: string; rowVersion: number; marksAssetsPrivate: boolean; changed: number }>(
    `${base}/people/${encodeURIComponent(person.id)}/privacy`,
    {
      method: 'PATCH',
      body: JSON.stringify({ marksAssetsPrivate, rowVersion: person.rowVersion }),
    },
  );

export interface PhotoMapViewport {
  west: number;
  east: number;
  south: number;
  north: number;
  zoom: number;
}
export interface PhotoMapCluster {
  cover?: EagleAssetListItem | null;
  id: string;
  latitude: number;
  longitude: number;
  count: number;
  photoLatitude?: number;
  photoLongitude?: number;
  south?: number;
  north?: number;
  west?: number;
  east?: number;
}
export interface PhotoMapData {
  status?: 'PENDING' | 'UPDATING' | 'READY';
  partial?: boolean;
  updatedAt?: string | null;
  snapshotId?: string | null;
  minimumPhotoCount?: number;
  total: number;
  bounds: Omit<PhotoMapViewport, 'zoom'> | null;
  level: number;
  clusters: PhotoMapCluster[];
}
export const getPhotoMap = (view: PhotoMapViewport, signal?: AbortSignal) =>
  request<PhotoMapData>(
    `${base}/map?${new URLSearchParams(Object.entries(view).map(([key, value]) => [key, String(value)]))}`,
    { signal },
  );
export const getPhotoMapPhotos = (cell: string, after?: string, signal?: AbortSignal) =>
  request<{ items: EagleAssetListItem[]; nextCursor: string | null }>(
    `${base}/map/${encodeURIComponent(cell)}/photos${after ? `?after=${encodeURIComponent(after)}` : ''}`,
    { signal },
  );

export interface PhotoPersonReview {
  key: string;
  first: PhotoPerson & { photoCount?: number };
  second: PhotoPerson & { photoCount?: number };
  similarity: number;
}
export const getPhotoPeopleSummary = () =>
  request<{ named: number; unnamed: number }>(`${base}/people/summary`);
// Start with the largest visible identities, then retain full-library pagination.
const PRIORITY_REVIEW_COMPLETE = 'priority-complete';
export async function getPhotoPeopleReview(
  after?: string,
  signal?: AbortSignal,
): Promise<{ items: PhotoPersonReview[]; nextCursor: string | null }> {
  if (after === undefined) {
    const { pairs } = await reviewPhotoPeople(signal);
    return {
      items: pairs.map((pair) => ({
        ...pair,
        key: [pair.first.id, pair.second.id].sort().join(':'),
      })),
      nextCursor: PRIORITY_REVIEW_COMPLETE,
    };
  }
  return request(
    `${base}/people/review${after === PRIORITY_REVIEW_COMPLETE ? '' : `?after=${encodeURIComponent(after)}`}`,
    { signal },
  );
}
export const decidePhotoPeople = (input: {
  firstId: string;
  secondId: string;
  firstVersion: number;
  secondVersion: number;
  decision: 'SAME' | 'DIFFERENT';
}) => request(`${base}/people/review`, { method: 'POST', body: JSON.stringify(input) });
