import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createEagleQueryKeys } from './eagle-query-keys';
import { refreshEagleAssetRelations } from './eagle-write-refresh';
import { makeEagleAsset } from '../../test/eagle-fixtures';
it.each(['MATERIAL', 'PHOTO'] as const)(
  'relationship writes refresh all cached membership in %s, without touching other scopes',
  async (mode) => {
    const client = new QueryClient();
    const keys = createEagleQueryKeys('owner', mode);
    const affected = [
      keys.assetList('ACTIVE', {}),
      keys.assetList('ACTIVE', { tagIds: ['t'] }),
      keys.assetDetail('a', 'ACTIVE'),
      keys.manualTags,
      keys.manualTagGroups,
      keys.smartFolders,
      [...keys.root, 'vector-summary'],
    ];
    affected.forEach((key) => client.setQueryData(key, makeEagleAsset()));
    const other = createEagleQueryKeys('other', mode).assets;
    client.setQueryData(other, {});
    await refreshEagleAssetRelations(client, keys, ['a']);
    affected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  },
);
it('desktop invalidation failure cannot prevent query refresh', async () => {
  const client = new QueryClient(),
    keys = createEagleQueryKeys('owner');
  client.setQueryData(keys.manualTags, []);
  vi.stubGlobal('sekerDesktop', {
    version: 1,
    createMediaUrl: vi.fn(),
    getCacheStatus: vi.fn(),
    setCacheLimitGiB: vi.fn(),
    clearCache: vi.fn(),
    invalidateAsset: vi.fn().mockRejectedValue(new Error('disk failure')),
  });
  try {
    await expect(refreshEagleAssetRelations(client, keys, ['a'])).rejects.toThrow('disk failure');
    expect(client.getQueryState(keys.manualTags)?.isInvalidated).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    client.clear();
  }
});
