import { makeEagleAsset, makeEaglePage } from '../../test/eagle-fixtures';
import type * as BrowserApi from '../../lib/api-client';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import { createEagleQueryKeys } from './eagle-query-keys';

const fetchOriginal = vi.hoisted(() => vi.fn());
vi.mock('../../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserApi>()),
  fetchWithBrowserSession: fetchOriginal,
}));
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
  vi.unstubAllGlobals();
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

it('keeps an active download across public query GC but cancels it on session clear', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 25 } } });
  clients.push(client);
  const cache = getEagleWorkspaceCache(client, 'owner', 'PHOTO');
  const keys = createEagleQueryKeys('owner', 'PHOTO');
  client.setQueryData(keys.assetList('ACTIVE', {}), { pages: [] });
  const leave = cache.retain(false);
  vi.stubGlobal(
    'showDirectoryPicker',
    vi.fn().mockResolvedValue({
      getDirectoryHandle: async () => ({
        getFileHandle: async () => ({
          createWritable: async () => ({ write: vi.fn(), close: vi.fn(), abort: vi.fn() }),
        }),
        removeEntry: vi.fn(),
      }),
    }),
  );
  let requested!: () => void;
  const started = new Promise<void>((done) => {
    requested = done;
  });
  fetchOriginal.mockImplementation(
    (_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        requested();
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  cache.downloads.enqueue([{ id: 'a', originalName: 'large.jpg', libraryMode: 'PHOTO' }]);
  const saving = cache.downloads.saveToDirectory();
  await started;
  leave();
  await vi.advanceTimersByTimeAsync(26);
  expect(cache.downloads.getSnapshot().running).toBe(true);
  client.clear();
  await saving;
  expect(cache.downloads.getSnapshot().items).toHaveLength(0);
});

it('reclaims only unreferenced entities after query removal, truncation and detail removal', async () => {
  vi.useFakeTimers();
  const { client, cache, keys } = fixture();
  const release = cache.retain(false);
  const page = (ids: string[]) => cache.store.normalizePage(makeEaglePage(ids));
  const first = keys.assetList('ACTIVE', {}),
    second = keys.assetList('ACTIVE', { search: 'old' });
  client.setQueryData(first, { pages: [page(['shared', 'current']), page(['tail'])] });
  client.setQueryData(second, { pages: [page(['shared', 'old'])] });
  client.setQueryData([...keys.assetDetailPrefix('old'), 'ACTIVE'], makeEagleAsset({ id: 'old' }));
  client.removeQueries({ queryKey: second, exact: true });
  client.setQueryData(first, { pages: [page(['shared', 'current'])] });
  await vi.advanceTimersByTimeAsync(1);
  expect(cache.store.get('tail')).toBeUndefined();
  expect(cache.store.get('shared')).toBeDefined();
  expect(cache.store.get('old')).toBeDefined();
  client.removeQueries({ queryKey: keys.assetDetailPrefix('old') });
  await vi.advanceTimersByTimeAsync(1);
  expect(cache.store.get('old')).toBeUndefined();
  expect(cache.store.size).toBe(2);
  release();
});

it('keeps an independently cached detail after the final list leaves and collects it on detail GC', async () => {
  vi.useFakeTimers();
  const { client, cache, keys } = fixture();
  const leave = cache.retain(false);
  const detail = makeEagleAsset({ id: 'detail' });
  cache.store.upsertMany([detail]);
  client.setQueryData(keys.assetDetail(detail.id, 'ACTIVE'), detail);
  client.removeQueries({ queryKey: keys.assetList('ACTIVE', {}), exact: true });
  leave();
  await vi.advanceTimersByTimeAsync(1);
  expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL')).toBe(cache);
  expect(cache.store.get(detail.id)).toBeDefined();
  client.removeQueries({ queryKey: keys.assetDetails });
  await vi.advanceTimersByTimeAsync(1);
  expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL')).not.toBe(cache);
  expect(cache.store.size).toBe(0);
});

it('aborts a real in-flight query on privacy reset before its late response can normalize', async () => {
  const { client, cache, keys } = fixture();
  let resolvePage!: (page: ReturnType<typeof makeEaglePage>) => void;
  let signal!: AbortSignal;
  const response = new Promise<ReturnType<typeof makeEaglePage>>((resolve) => {
    resolvePage = resolve;
  });
  const key = keys.assetList('PRIVATE', {});
  const request = client
    .fetchInfiniteQuery({
      queryKey: key,
      initialPageParam: undefined,
      queryFn: async (context) => {
        signal = context.signal;
        const page = await response;
        signal.throwIfAborted();
        return cache.store.normalizePage(page);
      },
    })
    .catch(() => undefined);
  cache.store.clear();
  await client.resetQueries({ queryKey: keys.root });
  expect(signal.aborted).toBe(true);
  resolvePage(makeEaglePage(['private-late']));
  await request;
  await Promise.resolve();
  expect(cache.store.size).toBe(0);
  expect(client.getQueryData(key)).toBeUndefined();
});
