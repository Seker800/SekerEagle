export interface EagleRendition {
  id: string;
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
export interface EagleAssetListItem {
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
  libraryAddedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  renditions: EagleRendition[];
  manualTags: EagleManualTagRef[];
}
export interface EagleAsset extends EagleAssetListItem {
  annotation: { color: string | null; description: string | null; sourceUrl: string | null } | null;
  aiTags: EagleAiTagRef[];
  colorAnalysis: EagleColorAnalysis | null;
}
export interface EagleAssetUpdate {
  id: string;
  lifecycleStatus: EagleAssetListItem['lifecycleStatus'];
  mediaErrorCode: string | null;
  updatedAt: string;
  renditions: EagleRendition[];
}
export interface EagleMediaCapabilities {
  version: 1;
  images: { mimeTypes: string[]; extensions: string[]; maxBytes: number; maxPixels: number };
  videos: {
    mimeTypes: string[];
    extensions: string[];
    maxBytes: number;
    maxDurationMs: number | null;
  };
}
export interface EagleManualTag extends EagleManualTagRef {
  groupId: string | null;
  groupIds: string[];
  isStarred: boolean;
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
  queryJson: { version: 1; filters: EagleSmartFolderFilters };
  position: number;
  rowVersion: number;
}
export interface EagleAssetFilters {
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
export interface EagleAssetPage {
  items: EagleAssetListItem[];
  nextCursor: string | null;
  colorCoverage: {
    eligible: number;
    completed: number;
    percentage: number;
    processorVersion: string;
  } | null;
}
export type EagleSmartFolderFilters = Omit<
  EagleAssetFilters,
  'cursor' | 'limit' | 'smartFolderId' | 'color'
> & {
  assetColor?: string;
  tagMatch?: 'ANY' | 'ALL';
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message) ? body.message.join('；') : body?.message;
    throw new Error(message ?? `请求失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function assetQuery(filters: EagleAssetFilters): string {
  const query = new URLSearchParams({ limit: String(filters.limit ?? 100) });
  for (const key of [
    'cursor',
    'smartFolderId',
    'search',
    'createdFrom',
    'createdTo',
    'color',
  ] as const) {
    if (filters[key]) query.set(key, filters[key]);
  }
  for (const key of ['rating', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
    if (filters[key] !== undefined) query.set(key, String(filters[key]));
  }
  for (const key of ['formats', 'manualTagIds', 'aiTagIds'] as const) {
    if (filters[key]?.length) query.set(key, filters[key].join(','));
  }
  return query.toString();
}

function normalizeAsset<T extends EagleAssetListItem>(asset: T): T {
  return {
    ...asset,
    aiTags: 'aiTags' in asset && Array.isArray(asset.aiTags) ? asset.aiTags : [],
    colorAnalysis: 'colorAnalysis' in asset ? (asset.colorAnalysis ?? null) : null,
  };
}

export function getEagleMediaCapabilities(_accessToken: string) {
  return api<EagleMediaCapabilities>('/eagle/media-capabilities');
}
export async function listEagleAssets(
  _token: string,
  filters: EagleAssetFilters = {},
  signal?: AbortSignal,
): Promise<EagleAssetPage> {
  const result = await api<EagleAssetPage>(`/eagle/assets?${assetQuery(filters)}`, { signal });
  return { ...result, items: result.items.map(normalizeAsset) };
}
export async function listEagleTrash(
  _token: string,
  filters: EagleAssetFilters = {},
  signal?: AbortSignal,
): Promise<EagleAssetPage> {
  const result = await api<EagleAssetPage>(`/eagle/trash?${assetQuery(filters)}`, { signal });
  return { ...result, items: result.items.map(normalizeAsset) };
}
export async function getEagleAsset(_token: string, id: string, signal?: AbortSignal) {
  return normalizeAsset(
    await api<EagleAsset>(`/eagle/assets/${encodeURIComponent(id)}`, { signal }),
  );
}
export async function getEagleTrashAsset(_token: string, id: string, signal?: AbortSignal) {
  return normalizeAsset(
    await api<EagleAsset>(`/eagle/trash/${encodeURIComponent(id)}`, { signal }),
  );
}
export async function listEagleAssetUpdates(
  _token: string,
  ids: readonly string[],
  signal?: AbortSignal,
) {
  if (!ids.length) return [];
  return api<
    Array<
      Pick<EagleAsset, 'id' | 'lifecycleStatus' | 'mediaErrorCode' | 'updatedAt' | 'renditions'>
    >
  >('/eagle/asset-updates', {
    method: 'POST',
    body: JSON.stringify({ assetIds: ids }),
    signal,
  });
}

function normalizeTag(
  tag: Partial<EagleManualTag> & EagleManualTagRef & { _count?: { assetLinks: number } },
): EagleManualTag {
  return {
    ...tag,
    groupId: tag.groupId ?? null,
    groupIds: tag.groupIds ?? (tag.groupId ? [tag.groupId] : []),
    isStarred: tag.isStarred ?? false,
    rowVersion: tag.rowVersion ?? 1,
    assetCount: tag.assetCount ?? tag._count?.assetLinks ?? 0,
    pinyin: tag.pinyin ?? tag.name,
    pinyinInitials: tag.pinyinInitials ?? tag.name,
  };
}
export async function listEagleManualTags(_token: string) {
  return (await api<Array<Parameters<typeof normalizeTag>[0]>>('/eagle/tags')).map(normalizeTag);
}
export async function createEagleManualTag(
  _token: string,
  input: { name: string; color?: string | null },
) {
  return normalizeTag(
    await api<Parameters<typeof normalizeTag>[0]>('/eagle/tags', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}
export async function updateEagleManualTag(
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
export async function deleteEagleManualTag(_token: string, id: string) {
  await api(`/eagle/tags/${id}`, { method: 'DELETE' });
  return { deletedId: id };
}
export async function listEagleManualTagGroups(_token: string) {
  return api<EagleManualTagGroup[]>('/eagle/tag-groups');
}
export async function createEagleManualTagGroup(
  _token: string,
  input: { name: string; color?: string | null; description?: string | null },
) {
  return api<EagleManualTagGroup>('/eagle/tag-groups', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export async function updateEagleManualTagGroup(
  _token: string,
  id: string,
  input: { name?: string; color?: string | null; description?: string | null; rowVersion: number },
) {
  return api<EagleManualTagGroup>(`/eagle/tag-groups/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
export async function deleteEagleManualTagGroup(_token: string, id: string) {
  await api(`/eagle/tag-groups/${id}`, { method: 'DELETE' });
  return { deletedId: id };
}
export async function listEagleAiTags(_token: string) {
  return api<EagleAiTag[]>('/eagle/ai-tags');
}
export async function listEagleSmartFolders(_token: string) {
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
export async function createEagleSmartFolder(
  _token: string,
  input: EagleSmartFolderFilters & { name: string },
) {
  const { name, ...filters } = input;
  return api<EagleSmartFolder>('/eagle/smart-folders', {
    method: 'POST',
    body: JSON.stringify({ name, query: { version: 1, filters } }),
  });
}
export async function updateEagleSmartFolder(
  _token: string,
  id: string,
  input: EagleSmartFolderFilters & { name?: string; color?: string | null; rowVersion: number },
) {
  const { name, color, rowVersion, ...filters } = input;
  const query = Object.keys(filters).length ? { version: 1, filters } : undefined;
  return api<EagleSmartFolder>(`/eagle/smart-folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name, color, rowVersion, query }),
  });
}
export async function moveEagleSmartFolder(
  _token: string,
  id: string,
  input: { parentId: string | null; position: number; rowVersion: number },
) {
  return api<EagleSmartFolder>(`/eagle/smart-folders/${id}/move`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export async function replaceEagleAssetManualTags(_token: string, id: string, tagIds: string[]) {
  await api(`/eagle/assets/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) });
  return { assetId: id, tagIds };
}
export async function batchChangeEagleManualTags(
  _token: string,
  input: { assetIds: string[]; addTagIds: string[]; removeTagIds: string[] },
) {
  return api<{ affectedAssetCount: number }>('/eagle/assets/batch/manual-tags', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
export async function batchTrashEagleAssets(_token: string, assetIds: string[]) {
  return api<{ affectedAssetCount: number }>('/eagle/assets/batch/trash', {
    method: 'POST',
    body: JSON.stringify({ assetIds }),
  });
}
export async function batchRestoreEagleAssets(_token: string, assetIds: string[]) {
  return api<{ affectedAssetCount: number }>('/eagle/assets/batch/restore', {
    method: 'POST',
    body: JSON.stringify({ assetIds }),
  });
}
export async function emptyEagleTrash(_token: string) {
  return api<{ affectedAssetCount: number }>('/eagle/trash/empty', { method: 'POST', body: '{}' });
}
export async function updateEagleAsset(
  _token: string,
  id: string,
  input: EagleAssetChanges & { rowVersion: number },
) {
  return normalizeAsset(
    await api<EagleAsset>(`/eagle/assets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  );
}
export async function batchUpdateEagleAssets(
  _token: string,
  input: EagleAssetChanges & { assets: EagleAssetVersion[] },
) {
  return api<{ affectedAssetCount: number; assets: EagleAssetVersion[] }>('/eagle/assets/batch', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function uploadEagleAsset(
  _token: string,
  file: File,
  onProgress: (value: { percent: number }) => void,
) {
  const session = await api<{ id: string; partSize: number }>('/eagle/uploads', {
    method: 'POST',
    body: JSON.stringify({
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    }),
  });
  const parts: Array<{ partNumber: number; etag: string }> = [];
  try {
    const count = Math.ceil(file.size / session.partSize);
    for (let index = 0; index < count; index += 1) {
      const partNumber = index + 1;
      const { uploadUrl } = await api<{ uploadUrl: string }>(
        `/eagle/uploads/${session.id}/parts/${partNumber}`,
        { method: 'POST', body: '{}' },
      );
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: file.slice(
          index * session.partSize,
          Math.min(file.size, (index + 1) * session.partSize),
        ),
      });
      if (!response.ok) throw new Error(`上传分片失败（${response.status}）`);
      const etag = response.headers.get('etag');
      if (!etag) throw new Error('对象存储未返回分片校验值。');
      parts.push({ partNumber, etag });
      onProgress({ percent: Math.round((partNumber / count) * 100) });
    }
    const completed = await api<{ assetId: string; duplicate: boolean }>(
      `/eagle/uploads/${session.id}/complete`,
      { method: 'POST', body: JSON.stringify({ parts }) },
    );
    return { duplicate: completed.duplicate, asset: await getEagleAsset('', completed.assetId) };
  } catch (error) {
    await api(`/eagle/uploads/${session.id}`, { method: 'DELETE', body: '{}' }).catch(
      () => undefined,
    );
    throw error;
  }
}
export function getEagleAssetContentUrl(id: string) {
  return `/api/eagle/assets/${encodeURIComponent(id)}/original`;
}
export function getEagleRenditionContentUrl(assetId: string, renditionId: string) {
  return `/api/eagle/assets/${encodeURIComponent(assetId)}/renditions/${encodeURIComponent(renditionId)}`;
}
