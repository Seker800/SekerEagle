import { InfiniteQueryObserver, QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AssetOperationRefresher } from './asset-operation-refresh';

it('coalesces publications, automatically refreshes all loaded pages, and leaves inactive and other owner caches alone', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const key = ['eagle', 'owner', 'PHOTO', 'assets', 'ACTIVE', {}];
  const page = (i: number) => ({ ids: [`survivor-${i}`], nextCursor: String(i + 1) });
  const data = { pages: Array.from({ length: 12 }, (_, i) => ({ ...page(i), ids: [`deleted-${i}`, `survivor-${i}`] })), pageParams: Array.from({ length: 12 }, (_, i) => String(i)) };
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const queryFn = vi.fn(async ({ pageParam }: { pageParam: string }) => { await pending; return page(Number(pageParam)); });
  const observer = new InfiniteQueryObserver(client, { queryKey: key, queryFn, initialPageParam: '0', getNextPageParam: (p) => p.nextCursor, initialData: data });
  const unsubscribe = observer.subscribe(() => {});
  const inactiveKey = ['eagle', 'owner', 'PHOTO', 'assets', 'TRASH', {}];
  const otherKey = ['eagle', 'other', 'PHOTO', 'assets', 'ACTIVE', {}];
  client.setQueryData(inactiveKey, data);
  client.setQueryData(otherKey, data);
  const progress = new AssetOperationRefresher(client, 'owner');
  try {
    for (let i = 0; i < 100; i++) progress.schedule('PHOTO', i === 99);
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(key)).toEqual(data);
    release();
    await vi.waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('idle'));
    expect(queryFn).toHaveBeenCalledTimes(12);
    expect(client.getQueryData(key)).toEqual({ pages: Array.from({ length: 12 }, (_, i) => page(i)), pageParams: data.pageParams });
    expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    expect(client.getQueryData(inactiveKey)).toEqual(data);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  } finally { release(); progress.dispose(); unsubscribe(); client.clear(); }
});

it('finishes a refresh already in flight before applying a newer publication', async () => {
  const client = new QueryClient();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementationOnce(() => pending).mockResolvedValue(undefined);
  const progress = new AssetOperationRefresher(client, 'owner');
  progress.schedule('PHOTO', false);
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  for (let i = 0; i < 20; i++) progress.schedule('PHOTO', true);
  await Promise.resolve();
  expect(invalidate).toHaveBeenCalledTimes(1);
  release();
  await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  expect(invalidate.mock.calls[0]?.[1]).toEqual({ cancelRefetch: false });
  progress.dispose();
  progress.schedule('PHOTO', true);
  await Promise.resolve();
  expect(invalidate).toHaveBeenCalledTimes(2);
  client.clear();
});
