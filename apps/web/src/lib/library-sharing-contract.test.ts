import { afterEach, expect, it, vi } from 'vitest';
import { createEagleApi } from './eagle-api';
import { createEagleAiTagApi } from './eagle-ai-tag-api';
import { createEagleVectorApi } from './eagle-vector-api';
import { createEagleProcessingAdminApi } from './eagle-processing-admin-api';
import { createEaglePrivacyApi } from './eagle-privacy-api';
import { createPrivacyVisibilityApi } from './privacy-visibility-api';
import type { LibraryMode } from './library-api-scope';
import { createImageEdit } from '@sekereagle/library-core';

afterEach(() => vi.restoreAllMocks());
const factories = [
  createEagleApi,
  createEagleAiTagApi,
  createEagleVectorApi,
  createEagleProcessingAdminApi,
  createEaglePrivacyApi,
  createPrivacyVisibilityApi,
];
for (const factory of factories) {
  it(`${factory.name} exposes the same operations in both modes`, () => {
    expect(Object.keys(factory('PHOTO')).sort()).toEqual(Object.keys(factory('MATERIAL')).sort());
  });
}
const operations = {
  imageEdit: (mode: LibraryMode) =>
    createEagleApi(mode).saveEagleImageEdit('', 'asset', {
      operationId: 'operation',
      rowVersion: 1,
      edit: createImageEdit(),
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
  aiTags: (mode: LibraryMode) => createEagleAiTagApi(mode).fetchEagleAiTagSummary(),
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
    expect(photo[1]).toEqual(material[1]);
    expect(results[1]).toEqual(results[0]);
  });
}
