import type { components } from '@sekereagle/contracts';
import { normalizeCameraMimeType } from '@sekereagle/library-core';
import { libraryApiPath, type LibraryMode } from './library-api-scope';
import { t } from '../i18n';

import { errorFromResponse } from './api-error';

import type { EagleFilterQuery, LegacyEagleFilterQuery } from '@sekereagle/eagle-filter-core';

import { fetchWithBrowserSession } from './api-client';

import { resolveEagleRenditionUrl } from './media-resolver';

import { resolveObjectUploadUrl } from './object-upload-url';

export interface EagleRendition {
  id: string;
  variant?: string;
  kind: 'THUMBNAIL' | 'PREVIEW' | 'POSTER';
  revision: number;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
}

export interface EagleManualTagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface EagleAiTagRef {
  id: string;
  name: string;
  confidence: number;
  status: 'ACTIVE' | 'HIDDEN' | 'REJECTED';
}

export interface EagleColorAnalysis {
  assetRevision: number;
  processorVersion: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  lastError: string | null;
  completedAt: string | null;
  swatches: Array<{
    rank: number;
    hex: string;
    weight: number;
    labL: number;
    labA: number;
    labB: number;
  }>;
}

export interface PhotoMetadata {
  capturedAt: string | null;
  capturedLocal: string | null;
  captureTimeZoneKnown: boolean;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  aperture: number | null;
  exposureSeconds: number | null;
  iso: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  sharpnessScore: number | null;
  perceptualHash: string | null;
}
export interface EagleAssetListItem {
  livePhotoMotion?: { assetId: string; renditionId: string; revision: number };
  chronologicalAt?: string;
  photoMetadata?: PhotoMetadata | null;
  libraryMode?: LibraryMode;
  id: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  format: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  lifecycleStatus: 'PROCESSING' | 'READY' | 'FAILED';
  mediaErrorCode: string | null;
  mediaRevision: number;
  rowVersion: number;
  rating: 1 | 2 | 3 | 4 | 5 | null;
  isPrivate?: boolean;
  libraryAddedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  renditions: EagleRendition[];
  manualTags: EagleManualTagRef[];
}

export interface EagleAsset extends EagleAssetListItem {
  annotation: {
    color: string | null;
    description: string | null;
    sourceUrl: string | null;
  } | null;
  aiTags: EagleAiTagRef[];
  colorAnalysis: EagleColorAnalysis | null;
}

type EagleAssetUpdateContract = components['schemas']['EagleAssetUpdateResponseDto'];
export interface EagleAssetUpdate extends EagleAssetUpdateContract {
  livePhotoComponent?: boolean;
  chronologicalAt?: string;
  photoMetadata?: PhotoMetadata | null;
}

export interface EagleMediaCapabilities {
  version: 1;
  images: {
    mimeTypes: string[];
    extensions: string[];
    maxBytes: number;
    maxPixels: number;
    maxRawPixels?: number;
  };
  videos: {
    mimeTypes: string[];
    extensions: string[];
    maxBytes: number;
    maxDurationMs: number | null;
  };
}

export interface EaglePyramidDescriptor {
  id: string;
  width: number;
  height: number;
  tileSize: number;
  overlap: number;
  format: 'webp';
  maxLevel: number;
  tileUrlTemplate: string;
}

export interface EagleManualTag extends EagleManualTagRef {
  groupId: string | null;
  groupIds: string[];
  isStarred: boolean;
  lastUsedAt: string | null;
  rowVersion: number;
  assetCount: number;
  pinyin: string;
  pinyinInitials: string;
}

export interface EagleManualTagGroup {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  rowVersion: number;
  tagCount: number;
}

export interface EagleAiTag {
  id: string;
  name: string;
  assetCount: number;
  pinyin: string;
  pinyinInitials: string;
}

export interface EagleSmartFolder {
  id: string;
  name: string;
  color: string | null;
  parentId: string | null;
  queryVersion: number;
  queryJson: EagleFilterQuery | LegacyEagleFilterQuery;
  position: number;
  rowVersion: number;
}

export interface EagleLibraryTransferResult {
  targetMode: LibraryMode;
  movedCount: number;
  componentCount: number;
  assets: Array<{ sourceId: string; assetId: string }>;
}

export interface EagleAssetLocation {
  assetId: string;
  cursor: string | null;
}

export interface EagleAssetFilters {
  personId?: string;
  cameraModel?: string;
  lensModel?: string;
  gps?: 'WITH' | 'WITHOUT';
  limit?: number;
  cursor?: string;
  smartFolderId?: string;
  search?: string;
  formats?: string[];
  manualTagIds?: string[];
  aiTagIds?: string[];
  rating?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  createdFrom?: string;
  createdTo?: string;
  color?: string;
  rules?: EagleFilterQuery;
  privacy?: 'PRIVATE';
}

export interface EagleAssetVersion {
  assetId: string;
  rowVersion: number;
}

export interface EagleAssetChanges {
  displayName?: string;
  rating?: number | null;
  color?: string | null;
  description?: string | null;
  sourceUrl?: string | null;
}

export interface EaglePhotoStack {
  id: string;
  bestAssetId: string;
  bestSelectedByUser: boolean;
  assetIds: string[];
  cover: EagleAssetListItem;
}
export interface EagleAssetPage {
  photoStacks?: EaglePhotoStack[];
  items: EagleAssetListItem[];
  nextCursor: string | null;
  colorCoverage: {
    eligible: number;
    completed: number;
    percentage: number;
    processorVersion: string;
  } | null;
  imageSearch?: { status: 'READY' | 'UNAVAILABLE'; spaceId: string };
}

export type EagleSmartFolderFilters = Omit<
  EagleAssetFilters,
  'cursor' | 'limit' | 'smartFolderId' | 'color'
> & {
  assetColor?: string;
  tagMatch?: 'ANY' | 'ALL';
};
export function createEagleApi(libraryMode: LibraryMode = 'MATERIAL') {
  // Retain only explicitly retryable editor uploads, scoped to this API factory and File identity.
  const editorUploads = new WeakMap<
    File,
    {
      sessionId: string;
      partSize: number;
      parts: Array<{ partNumber: number; etag: string }>;
      completedAssetId?: string;
      declaration: string;
    }
  >();
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchWithBrowserSession(libraryApiPath(`/api${path}`, libraryMode), {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
    if (!response.ok) {
      throw await errorFromResponse(response, '请求失败（{{value1}}）');
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  function assetQuery(filters: EagleAssetFilters): string {
    const query = new URLSearchParams({ limit: String(filters.limit ?? 100) });
    for (const key of [
      'personId',
      'cameraModel',
      'lensModel',
      'gps',
      'cursor',
      'smartFolderId',
      'search',
      'createdFrom',
      'createdTo',
      'color',
      'privacy',
    ] as const) {
      if (filters[key]) query.set(key, filters[key]);
    }
    for (const key of ['rating', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
      if (filters[key] !== undefined) query.set(key, String(filters[key]));
    }
    for (const key of ['formats', 'manualTagIds', 'aiTagIds'] as const) {
      if (filters[key]?.length) query.set(key, filters[key].join(','));
    }
    if (filters.rules) query.set('rules', JSON.stringify(filters.rules));
    return query.toString();
  }

  function normalizeAsset<T extends EagleAssetListItem>(asset: T): T {
    return {
      ...asset,
      isPrivate: asset.isPrivate ?? false,
      aiTags: 'aiTags' in asset && Array.isArray(asset.aiTags) ? asset.aiTags : [],
      colorAnalysis: 'colorAnalysis' in asset ? (asset.colorAnalysis ?? null) : null,
    };
  }

  function getEagleMediaCapabilities(_accessToken: string) {
    return api<EagleMediaCapabilities>('/eagle/media-capabilities');
  }

  async function listEagleAssets(
    _token: string,
    filters: EagleAssetFilters = {},
    signal?: AbortSignal,
  ): Promise<EagleAssetPage> {
    const result = await api<EagleAssetPage>(`/eagle/assets?${assetQuery(filters)}`, { signal });
    return { ...result, items: result.items.map(normalizeAsset) };
  }

  async function listEagleTrash(
    _token: string,
    filters: EagleAssetFilters = {},
    signal?: AbortSignal,
  ): Promise<EagleAssetPage> {
    const result = await api<EagleAssetPage>(`/eagle/trash?${assetQuery(filters)}`, { signal });
    return { ...result, items: result.items.map(normalizeAsset) };
  }

  async function sendEagleAssets(
    _token: string,
    input: { assetIds: string[]; operationId: string },
  ) {
    return api<EagleLibraryTransferResult>('/eagle/assets/batch/send', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function getEagleAssetLocation(_token: string, id: string, signal?: AbortSignal) {
    return api<EagleAssetLocation>(`/eagle/assets/${encodeURIComponent(id)}/location`, { signal });
  }

  async function getEagleAsset(_token: string, id: string, signal?: AbortSignal) {
    return normalizeAsset(
      await api<EagleAsset>(`/eagle/assets/${encodeURIComponent(id)}`, { signal }),
    );
  }

  async function getEagleTrashAsset(_token: string, id: string, signal?: AbortSignal) {
    return normalizeAsset(
      await api<EagleAsset>(`/eagle/trash/${encodeURIComponent(id)}`, { signal }),
    );
  }

  async function listEagleAssetUpdates(
    _token: string,
    ids: readonly string[],
    signal?: AbortSignal,
  ) {
    if (!ids.length) return [];
    return api<EagleAssetUpdate[]>('/eagle/asset-updates', {
      method: 'POST',
      body: JSON.stringify({ assetIds: ids }),
      signal,
    });
  }

  function normalizeTag(
    tag: Partial<EagleManualTag> &
      EagleManualTagRef & {
        _count?: {
          assetLinks: number;
        };
      },
  ): EagleManualTag {
    return {
      ...tag,
      groupId: tag.groupId ?? null,
      groupIds: tag.groupIds ?? (tag.groupId ? [tag.groupId] : []),
      isStarred: tag.isStarred ?? false,
      lastUsedAt: tag.lastUsedAt ?? null,
      rowVersion: tag.rowVersion ?? 1,
      assetCount: tag.assetCount ?? tag._count?.assetLinks ?? 0,
      pinyin: tag.pinyin ?? tag.name,
      pinyinInitials: tag.pinyinInitials ?? tag.name,
    };
  }

  async function listEagleManualTags(_token: string) {
    return (await api<Array<Parameters<typeof normalizeTag>[0]>>('/eagle/tags')).map(normalizeTag);
  }

  async function createEagleManualTag(
    _token: string,
    input: {
      name: string;
      color?: string | null;
    },
  ) {
    return normalizeTag(
      await api<Parameters<typeof normalizeTag>[0]>('/eagle/tags', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  }

  async function updateEagleManualTag(
    _token: string,
    id: string,
    input: Partial<Pick<EagleManualTag, 'name' | 'color' | 'groupId' | 'isStarred'>> & {
      rowVersion: number;
    },
  ) {
    return normalizeTag(
      await api<Parameters<typeof normalizeTag>[0]>(`/eagle/tags/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
  }

  async function deleteEagleManualTag(_token: string, id: string) {
    await api(`/eagle/tags/${id}`, { method: 'DELETE' });
    return { deletedId: id };
  }

  async function listEagleManualTagGroups(_token: string) {
    return api<EagleManualTagGroup[]>('/eagle/tag-groups');
  }

  async function createEagleManualTagGroup(
    _token: string,
    input: {
      name: string;
      color?: string | null;
      description?: string | null;
    },
  ) {
    return api<EagleManualTagGroup>('/eagle/tag-groups', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function updateEagleManualTagGroup(
    _token: string,
    id: string,
    input: {
      name?: string;
      color?: string | null;
      description?: string | null;
      rowVersion: number;
    },
  ) {
    return api<EagleManualTagGroup>(`/eagle/tag-groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async function deleteEagleManualTagGroup(_token: string, id: string) {
    await api(`/eagle/tag-groups/${id}`, { method: 'DELETE' });
    return { deletedId: id };
  }

  async function listEagleAiTags(_token: string) {
    return api<EagleAiTag[]>('/eagle/ai-tags');
  }

  async function listEagleSmartFolders(_token: string) {
    const rows = await api<
      Array<
        Omit<EagleSmartFolder, 'queryJson'> & {
          queryJson?: EagleSmartFolder['queryJson'];
          query?: EagleSmartFolderFilters;
        }
      >
    >('/eagle/smart-folders');
    return rows.map((row) => ({
      ...row,
      queryVersion: row.queryVersion ?? 1,
      queryJson: row.queryJson ?? { version: 1, filters: row.query ?? {} },
    }));
  }

  async function createEagleSmartFolder(
    _token: string,
    input: {
      name: string;
      query: EagleFilterQuery;
    },
  ) {
    return api<EagleSmartFolder>('/eagle/smart-folders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function updateEagleSmartFolder(
    _token: string,
    id: string,
    input: {
      name?: string;
      color?: string | null;
      query?: EagleFilterQuery;
      rowVersion: number;
    },
  ) {
    return api<EagleSmartFolder>(`/eagle/smart-folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async function countEagleAssets(_token: string, query: EagleFilterQuery) {
    return api<{
      count: number;
    }>('/eagle/assets/filter-count', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  async function moveEagleSmartFolder(
    _token: string,
    id: string,
    input: {
      parentId: string | null;
      position: number;
      rowVersion: number;
    },
  ) {
    return api<EagleSmartFolder>(`/eagle/smart-folders/${id}/move`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function replaceEagleAssetManualTags(_token: string, id: string, tagIds: string[]) {
    return api<{
      affectedAssetCount: number;
      privacyChangedAssetCount: number;
    }>(`/eagle/assets/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) });
  }

  async function batchChangeEagleManualTags(
    _token: string,
    input: {
      assetIds: string[];
      addTagIds: string[];
      removeTagIds: string[];
      clearAll?: boolean;
    },
  ) {
    return api<{
      affectedAssetCount: number;
      privacyChangedAssetCount: number;
    }>('/eagle/assets/batch/manual-tags', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async function batchTrashEagleAssets(_token: string, assetIds: string[]) {
    return api<{
      affectedAssetCount: number;
    }>('/eagle/assets/batch/trash', {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    });
  }

  async function batchRestoreEagleAssets(_token: string, assetIds: string[]) {
    return api<{
      affectedAssetCount: number;
    }>('/eagle/assets/batch/restore', {
      method: 'POST',
      body: JSON.stringify({ assetIds }),
    });
  }

  async function emptyEagleTrash(_token: string) {
    return api<{
      affectedAssetCount: number;
    }>('/eagle/trash/empty', { method: 'POST', body: '{}' });
  }

  async function updateEagleAsset(
    _token: string,
    id: string,
    input: EagleAssetChanges & {
      rowVersion: number;
    },
  ) {
    return normalizeAsset(
      await api<EagleAsset>(`/eagle/assets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    );
  }

  async function batchUpdateEagleAssets(
    _token: string,
    input: EagleAssetChanges & {
      assets: EagleAssetVersion[];
    },
  ) {
    return api<{
      affectedAssetCount: number;
      assets: EagleAssetVersion[];
    }>('/eagle/assets/batch', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  async function uploadEagleAsset(
    _token: string,
    file: File,
    onProgress: (value: { percent: number }) => void,
    options?: {
      duplicatePolicy: 'CREATE_COPY';
      copySourceAssetId?: string;
      copySourceRowVersion?: number;
      retry?: boolean;
    },
  ) {
    const declaration = JSON.stringify({
      duplicatePolicy: options?.duplicatePolicy,
      copySourceAssetId: options?.copySourceAssetId,
      copySourceRowVersion: options?.copySourceRowVersion,
    });
    let retained = options?.retry ? editorUploads.get(file) : undefined;
    if (retained && retained.declaration !== declaration)
      throw new Error(t('原照片已变化，请重新打开编辑器。'));
    if (retained?.completedAssetId)
      return { duplicate: false, asset: await getEagleAsset('', retained.completedAssetId) };
    const session = retained
      ? { id: retained.sessionId, partSize: retained.partSize }
      : await api<{
          id: string;
          partSize: number;
        }>('/eagle/uploads', {
          method: 'POST',
          body: JSON.stringify({
            originalName: file.name,
            mimeType:
              normalizeCameraMimeType(file.name, file.type) ??
              (file.type || 'application/octet-stream'),
            size: file.size,
            ...(options ? { duplicatePolicy: options.duplicatePolicy } : {}),
            ...(options?.copySourceAssetId
              ? {
                  copySourceAssetId: options.copySourceAssetId,
                  copySourceRowVersion: options.copySourceRowVersion,
                }
              : {}),
          }),
        });
    if (options?.retry && !retained) {
      retained = { sessionId: session.id, partSize: session.partSize, parts: [], declaration };
      editorUploads.set(file, retained);
    }
    const parts = retained?.parts ?? [];
    try {
      const count = Math.ceil(file.size / session.partSize);
      for (let index = parts.length; index < count; index += 1) {
        const partNumber = index + 1;
        const { uploadUrl } = await api<{
          uploadUrl: string;
        }>(`/eagle/uploads/${session.id}/parts/${partNumber}`, { method: 'POST', body: '{}' });
        const response = await fetch(resolveObjectUploadUrl(uploadUrl, window.location.origin), {
          method: 'PUT',
          body: file.slice(
            index * session.partSize,
            Math.min(file.size, (index + 1) * session.partSize),
          ),
          credentials: 'omit',
        });
        if (!response.ok)
          throw new Error(
            t('上传分片失败（{{value1}}）', {
              value1: response.status,
            }),
          );
        const etag = response.headers.get('etag');
        if (!etag) throw new Error(t('对象存储未返回分片校验值。'));
        parts.push({ partNumber, etag });
        onProgress({ percent: Math.round((partNumber / count) * 100) });
      }
      const completed = await api<{
        assetId: string;
        duplicate: boolean;
      }>(`/eagle/uploads/${session.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ parts }),
      });
      if (retained) retained.completedAssetId = completed.assetId;
      return { duplicate: completed.duplicate, asset: await getEagleAsset('', completed.assetId) };
    } catch (error) {
      if (!options?.retry)
        await api(`/eagle/uploads/${session.id}`, { method: 'DELETE', body: '{}' }).catch(
          () => undefined,
        );
      throw error;
    }
  }

  function getEagleAssetContentUrl(id: string, mode: LibraryMode = libraryMode) {
    return libraryApiPath(`/api/eagle/assets/${encodeURIComponent(id)}/original`, mode);
  }

  function getEaglePyramidDescriptor(_token: string, assetId: string, signal?: AbortSignal) {
    return api<EaglePyramidDescriptor>(`/eagle/assets/${encodeURIComponent(assetId)}/pyramid`, {
      signal,
    });
  }

  function getEagleRenditionContentUrl(
    assetId: string,
    renditionId: string,
    renditionKind: EagleRendition['kind'],
    mode: LibraryMode = libraryMode,
  ) {
    return resolveEagleRenditionUrl(assetId, renditionId, renditionKind, mode);
  }
  return {
    getEagleMediaCapabilities,
    listEagleAssets,
    listEagleTrash,
    getEagleAsset,
    getEagleAssetLocation,
    sendEagleAssets,
    getEagleTrashAsset,
    listEagleAssetUpdates,
    listEagleManualTags,
    createEagleManualTag,
    updateEagleManualTag,
    deleteEagleManualTag,
    listEagleManualTagGroups,
    createEagleManualTagGroup,
    updateEagleManualTagGroup,
    deleteEagleManualTagGroup,
    listEagleAiTags,
    listEagleSmartFolders,
    createEagleSmartFolder,
    updateEagleSmartFolder,
    countEagleAssets,
    moveEagleSmartFolder,
    replaceEagleAssetManualTags,
    batchChangeEagleManualTags,
    batchTrashEagleAssets,
    batchRestoreEagleAssets,
    emptyEagleTrash,
    updateEagleAsset,
    batchUpdateEagleAssets,
    uploadEagleAsset,
    getEagleAssetContentUrl,
    getEaglePyramidDescriptor,
    getEagleRenditionContentUrl,
  };
}
export const {
  getEagleMediaCapabilities,
  listEagleAssets,
  listEagleTrash,
  getEagleAsset,
  getEagleAssetLocation,
  sendEagleAssets,
  getEagleTrashAsset,
  listEagleAssetUpdates,
  listEagleManualTags,
  createEagleManualTag,
  updateEagleManualTag,
  deleteEagleManualTag,
  listEagleManualTagGroups,
  createEagleManualTagGroup,
  updateEagleManualTagGroup,
  deleteEagleManualTagGroup,
  listEagleAiTags,
  listEagleSmartFolders,
  createEagleSmartFolder,
  updateEagleSmartFolder,
  countEagleAssets,
  moveEagleSmartFolder,
  replaceEagleAssetManualTags,
  batchChangeEagleManualTags,
  batchTrashEagleAssets,
  batchRestoreEagleAssets,
  emptyEagleTrash,
  updateEagleAsset,
  batchUpdateEagleAssets,
  uploadEagleAsset,
  getEagleAssetContentUrl,
  getEaglePyramidDescriptor,
  getEagleRenditionContentUrl,
} = createEagleApi();
