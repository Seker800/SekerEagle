import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AssetOperationRefresher } from './asset-operation-refresh';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';

it('background publications preserve every cached page and cursor without refetching', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = ['eagle', 'owner', 'PHOTO', 'assets', 'ALL', {}];
  const data = {
    pages: Array.from({ length: 12 }, (_, i) => ({ ids: [`item-${i}`], nextCursor: `${i + 1}` })),
    pageParams: Array.from({ length: 12 }, (_, i) => String(i)),
  };
  const queryFn = vi.fn(async () => ({ ids: ['updated'], nextCursor: 'next' }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn,
    initialPageParam: '',
    getNextPageParam: (p) => p.nextCursor,
    initialData: data,
  });
  const unsubscribe = observer.subscribe(() => {});
  const progress = new AssetOperationRefresher(client, 'owner');
  try {
    for (let i = 0; i < 100; i++) progress.schedule('PHOTO', i === 99);
    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(data);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(getEagleWorkspaceCache(client, 'owner', 'PHOTO').hasBackgroundChanges()).toBe(true);
    expect(getEagleWorkspaceCache(client, 'owner', 'MATERIAL').hasBackgroundChanges()).toBe(false);
    expect(getEagleWorkspaceCache(client, 'another-owner', 'PHOTO').hasBackgroundChanges()).toBe(
      false,
    );
  } finally {
    progress.dispose();
    unsubscribe();
    client.clear();
  }
});

it('refresh acknowledgment cannot conceal a newer publication and disposed observers do nothing', () => {
  const client = new QueryClient();
  const progress = new AssetOperationRefresher(client, 'owner');
  const cache = getEagleWorkspaceCache(client, 'owner', 'PHOTO');
  progress.schedule('PHOTO', false);
  const revision = cache.backgroundRevision;
  progress.schedule('PHOTO', true);
  cache.acknowledgeBackgroundChanges(revision);
  expect(cache.hasBackgroundChanges()).toBe(true);
  cache.acknowledgeBackgroundChanges(cache.backgroundRevision);
  expect(cache.hasBackgroundChanges()).toBe(false);
  progress.dispose();
  progress.schedule('PHOTO', true);
  expect(cache.hasBackgroundChanges()).toBe(false);
  client.clear();
});
