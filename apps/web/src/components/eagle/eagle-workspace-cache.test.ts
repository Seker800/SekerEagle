import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { createEagleQueryKeys } from './eagle-query-keys';

const clients: QueryClient[] = [];
function fixture(mode: 'MATERIAL' | 'PHOTO' = 'MATERIAL', owner = 'owner') {
  const client = new QueryClient();
  clients.push(client);
  const cache = getEagleWorkspaceCache(client, owner, mode);
  const keys = createEagleQueryKeys(owner, mode);
  client.setQueryData(keys.assetList('ACTIVE', {}), { pages: [{ assetIds: ['a'] }] });
  return { client, cache, keys };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
});

describe('workspace cache lifetime', () => {
  it.each(['MATERIAL', 'PHOTO'] as const)(
    'retains %s entities and thumbnail service across navigation',
    (mode) => {
      const { client, cache } = fixture(mode);
      const dispose = vi.spyOn(cache.thumbnails, 'dispose');
      cache.retain(false)();
      const returned = getEagleWorkspaceCache(client, 'owner', mode);
      expect(returned.store).toBe(cache.store);
      expect(returned.thumbnails).toBe(cache.thumbnails);
      expect(dispose).not.toHaveBeenCalled();
    },
  );

  it('collects entities and blob URLs when the last list expires, even if timeline/count remain', async () => {
    vi.useFakeTimers();
    const { client, cache, keys } = fixture();
    const dispose = vi.spyOn(cache.thumbnails, 'dispose');
    client.setQueryData([...keys.assets, 'timeline', false, 0], {});
    client.setQueryData([...keys.assets, 'library-count', false, 0], {});
    cache.retain(false)();
    client.removeQueries({ queryKey: keys.assetList('ACTIVE', {}), exact: true });
    expect(dispose).toHaveBeenCalledOnce();
    expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL')).not.toBe(cache);
  });

  it('collects an idle workspace through the actual query garbage collector', async () => {
    vi.useFakeTimers();
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: 25 } } });
    clients.push(client);
    const cache = getEagleWorkspaceCache(client, 'owner', 'PHOTO');
    const keys = createEagleQueryKeys('owner', 'PHOTO');
    client.setQueryData(keys.assetList('ACTIVE', {}), { pages: [] });
    const dispose = vi.spyOn(cache.thumbnails, 'dispose');
    cache.retain(false)();
    await vi.advanceTimersByTimeAsync(26);
    expect(dispose).toHaveBeenCalledOnce();
    expect(getEagleWorkspaceCache(client, 'owner', 'PHOTO')).not.toBe(cache);
  });

  it('keeps resources while another list or mounted consumer still needs them', async () => {
    const { client, cache, keys } = fixture();
    const first = cache.retain(false);
    const second = cache.retain(false);
    const dispose = vi.spyOn(cache.thumbnails, 'dispose');
    client.setQueryData(keys.assetList('TRASH', {}), { pages: [] });
    first();
    client.removeQueries({ queryKey: keys.assetList('ACTIVE', {}), exact: true });
    expect(dispose).not.toHaveBeenCalled();
    client.clear();
    expect(dispose).not.toHaveBeenCalled();
    second();
    second();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('discards unlocked pages, catalogs and thumbnails when leaving the workspace', async () => {
    const { client, cache, keys } = fixture();
    client.setQueryData(keys.manualTags, [{ name: 'private' }]);
    const dispose = vi.spyOn(cache.thumbnails, 'dispose');
    cache.retain(true)();
    await Promise.resolve();
    expect(client.getQueryCache().findAll({ queryKey: keys.root })).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(2);
    expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL')).not.toBe(cache);
  });

  it('isolates owners, modes and query clients, and clears on session reset', () => {
    const { client, cache } = fixture();
    const otherClient = new QueryClient();
    clients.push(otherClient);
    expect(getEagleWorkspaceCache(client, 'other', 'MATERIAL').store).not.toBe(cache.store);
    expect(getEagleWorkspaceCache(client, 'owner', 'PHOTO').store).not.toBe(cache.store);
    expect(getEagleWorkspaceCache(otherClient, 'owner', 'MATERIAL').store).not.toBe(cache.store);
    cache.retain(false)();
    const dispose = vi.spyOn(cache.thumbnails, 'dispose');
    client.clear();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('survives a StrictMode effect replay for an unlocked workspace', () => {
    const { client, cache } = fixture();
    const release = cache.retain(true);
    release();
    const releaseReplay = cache.retain(true);
    expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL')).toBe(cache);
    releaseReplay();
  });

  it('releases an empty workspace with no loaded list', async () => {
    const client = new QueryClient();
    clients.push(client);
    const cache = getEagleWorkspaceCache(client, 'owner', 'PHOTO');
    cache.retain(false)();
    await Promise.resolve();
    expect(getEagleWorkspaceCache(client, 'owner', 'PHOTO')).not.toBe(cache);
  });
});
