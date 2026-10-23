import { afterEach, expect, it, vi } from 'vitest';
import { createEagleApi } from './eagle-api';
import { libraryApiPath } from './library-api-scope';
import { createPrivacyVisibilityApi } from './privacy-visibility-api';

afterEach(() => vi.restoreAllMocks());
it('binds concurrent clients to separate routes without mutable global mode', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ items: [], nextCursor: null }));
  await Promise.all([
    createEagleApi('PHOTO').listEagleAssets('', { limit: 1 }),
    createEagleApi('MATERIAL').listEagleAssets('', { limit: 1 }),
  ]);
  expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
    '/api/photos/assets?limit=1',
    '/api/eagle/assets?limit=1',
  ]);
  expect(createEagleApi('PHOTO').getEagleAssetContentUrl('photo')).toBe(
    '/api/photos/assets/photo/original',
  );
});
it('uses a distinct photo privacy grant and maps only recognized API prefixes', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ enabled: false }));
  await createPrivacyVisibilityApi('PHOTO').getPrivacyVisibility();
  expect(fetchMock.mock.calls[0][0]).toBe('/api/photos/privacy-visibility');
  expect(libraryApiPath('/api/eagle-other', 'PHOTO')).toBe('/api/eagle-other');
  expect(libraryApiPath('/api/admin/eagle-processing/jobs', 'PHOTO')).toBe(
    '/api/admin/photo-processing/jobs',
  );
});

it('uses the same semantic intent, preview and cached-ranking contract in both libraries', async () => {
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ items: [], count: null }));
  const query = {
    version: 2 as const,
    conditions: [],
    semantic: { text: '海边日落', breadth: 'BALANCED' as const },
  };
  for (const mode of ['PHOTO', 'MATERIAL'] as const) {
    const api = createEagleApi(mode);
    await api.createEagleSmartFolder('', { name: '海边', query });
    await api.countEagleAssets('', query);
    await api.listEagleAssets('', { smartFolderId: 'folder', smartFolderOrder: 'RELEVANCE' });
  }
  const calls = fetchMock.mock.calls;
  expect(calls[0][0]).toBe('/api/photos/smart-folders');
  expect(calls[3][0]).toBe('/api/eagle/smart-folders');
  expect(calls[0][1]?.body).toBe(calls[3][1]?.body);
  expect(calls[1][1]?.body).toBe(calls[4][1]?.body);
  expect(calls[2][0]).toEqual(expect.stringContaining('smartFolderOrder=RELEVANCE'));
  expect(calls[5][0]).toEqual(expect.stringContaining('smartFolderOrder=RELEVANCE'));
});
