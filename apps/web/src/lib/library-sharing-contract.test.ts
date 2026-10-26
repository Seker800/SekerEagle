import { afterEach, expect, it, vi } from 'vitest';
import { createEagleApi } from './eagle-api';
import { createEagleVectorApi } from './eagle-vector-api';
import { createEagleProcessingAdminApi } from './eagle-processing-admin-api';
import { createEagleTaskCenterApi } from './eagle-task-center-api';
import { createEaglePrivacyApi } from './eagle-privacy-api';
import { createPrivacyVisibilityApi } from './privacy-visibility-api';
import type { LibraryMode } from './library-api-scope';

afterEach(() => vi.restoreAllMocks());
const factories = [
  createEagleApi,
  createEagleVectorApi,
  createEagleProcessingAdminApi,
  createEagleTaskCenterApi,
  createEaglePrivacyApi,
  createPrivacyVisibilityApi,
];
for (const factory of factories) {
  it(`${factory.name} exposes the same operations in both modes`, () => {
    expect(Object.keys(factory('PHOTO')).sort()).toEqual(Object.keys(factory('MATERIAL')).sort());
  });
}
const operations = {
  tasks: (mode: LibraryMode) => createEagleTaskCenterApi(mode).fetchEagleTaskCenter(),
  taskEvents: (mode: LibraryMode) =>
    createEagleTaskCenterApi(mode).fetchEagleTaskEvents('EMBEDDING'),
  taskHistory: (mode: LibraryMode) => createEagleTaskCenterApi(mode).fetchEagleTaskHistory(),
  taskSchedule: (mode: LibraryMode) =>
    createEagleTaskCenterApi(mode).updateEagleTaskSchedule({
      mode: 'MANUAL',
      nightStart: '23:00',
      nightEnd: '06:00',
    }),
  taskRetry: (mode: LibraryMode) =>
    createEagleTaskCenterApi(mode).retryEagleTaskFamily('EMBEDDING'),
  taskPolicy: (mode: LibraryMode) =>
    createEagleTaskCenterApi(mode).updateEagleTaskPolicy({
      family: 'EMBEDDING',
      paused: true,
      priority: 1,
    }),
  send: (mode: LibraryMode) =>
    createEagleApi(mode).sendEagleAssets('', { assetIds: ['asset'], operationId: 'operation' }),
  location: (mode: LibraryMode) => createEagleApi(mode).getEagleAssetLocation('', 'asset'),
  list: (mode: LibraryMode) =>
    createEagleApi(mode).listEagleAssets('', { limit: 20, search: 'cat' }),
  tags: (mode: LibraryMode) =>
    createEagleApi(mode).replaceEagleAssetManualTags('', 'asset', ['tag']),
  trash: (mode: LibraryMode) => createEagleApi(mode).batchTrashEagleAssets('', ['asset']),
  restore: (mode: LibraryMode) => createEagleApi(mode).batchRestoreEagleAssets('', ['asset']),
  filters: (mode: LibraryMode) =>
    createEagleApi(mode).countEagleAssets('', { version: 2, conditions: [] }),
  vectors: (mode: LibraryMode) => createEagleVectorApi(mode).fetchEagleVectorSummary(),
  processing: (mode: LibraryMode) =>
    createEagleProcessingAdminApi(mode).fetchEagleProcessingSummary(''),
  privacy: (mode: LibraryMode) => createEaglePrivacyApi(mode).getEaglePrivacySettings(),
  visibility: (mode: LibraryMode) => createPrivacyVisibilityApi(mode).getPrivacyVisibility(),
};
for (const [name, execute] of Object.entries(operations)) {
  it(`${name} keeps method, payload, credentials and result semantics while changing only scope`, async () => {
    const response = { items: [], nextCursor: null, count: 0 };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(response));
    const results = await Promise.all([execute('MATERIAL'), execute('PHOTO')]);
    const [material, photo] = fetchMock.mock.calls;
    if (typeof material[0] !== 'string') throw new Error('Expected a scoped URL string');
    expect(photo[0]).toBe(
      material[0]
        .replace('/api/auth/privacy-visibility', '/api/photos/privacy-visibility')
        .replace('/api/admin/eagle-processing', '/api/admin/photo-processing')
        .replace('/api/eagle', '/api/photos'),
    );
    const { signal: photoSignal, ...photoInit } = photo[1]!;
    const { signal: materialSignal, ...materialInit } = material[1]!;
    expect(photoInit).toEqual(materialInit);
    expect(photoSignal).toBeInstanceOf(AbortSignal);
    expect(materialSignal).toBeInstanceOf(AbortSignal);
    expect(photoSignal?.aborted).toBe(false);
    expect(materialSignal?.aborted).toBe(false);
    expect(results[1]).toEqual(results[0]);
  });
}

it.each(['MATERIAL', 'PHOTO'] as const)(
  'edited copies bind source declarations and upload sessions to %s',
  async (mode) => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ message: 'stop after declaration' }, { status: 400 }));
    await expect(
      createEagleApi(mode).uploadEagleAsset(
        '',
        new File(['png'], 'edited.png', { type: 'image/png' }),
        vi.fn(),
        {
          duplicatePolicy: 'CREATE_COPY',
          copySourceAssetId: 'source',
          copySourceRowVersion: 4,
          retry: true,
        },
      ),
    ).rejects.toThrow('stop after declaration');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/${mode === 'PHOTO' ? 'photos' : 'eagle'}/uploads`,
    );
    const rawBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof rawBody !== 'string') throw new Error('Expected a JSON request body');
    const body = JSON.parse(rawBody);
    expect(body).toMatchObject({
      duplicatePolicy: 'CREATE_COPY',
      copySourceAssetId: 'source',
      copySourceRowVersion: 4,
    });
    expect(body).not.toHaveProperty('ownerId');
    expect(body).not.toHaveProperty('retry');
  },
);
