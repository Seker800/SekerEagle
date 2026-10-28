import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetOperationRefresher } from './asset-operation-refresh';
const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
});
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const queue = new AssetOperationRefresher(client, 'owner');
  disposals.push(
    () => queue.dispose(),
    () => client.clear(),
  );
  const key = ['eagle', 'owner', 'PHOTO', 'assets', 'ALL', {}];
  const queryFn = vi.fn(async (_context: { signal: AbortSignal }) => ({
    ids: ['current'],
    nextCursor: 'next',
  }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn,
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor,
    initialData: {
      pages: Array.from({ length: 12 }, () => ({ ids: ['old'], nextCursor: 'next' })),
      pageParams: Array.from({ length: 12 }, (_, i) => String(i)),
    },
  });
  disposals.push(observer.subscribe(() => {}));
  return { client, queue, key, queryFn };
}
it('progress fetches only the first cached page and leaves other modes and reference data alone', async () => {
  const { client, queue, key, queryFn } = fixture();
  const tagFn = vi.fn(async () => []);
  const tags = new QueryObserver(client, {
    queryKey: ['eagle', 'owner', 'PHOTO', 'manual-tags'],
    queryFn: tagFn,
    initialData: [],
  });
  disposals.push(tags.subscribe(() => {}));
  client.setQueryData(['eagle', 'owner', 'MATERIAL', 'assets', 'ALL', {}], {
    pages: [{ ids: ['material'] }],
    pageParams: [''],
  });
  queue.schedule('PHOTO', false);
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(client.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(1),
  );
  expect(tagFn).not.toHaveBeenCalled();
  expect(
    client.getQueryState(['eagle', 'owner', 'MATERIAL', 'assets', 'ALL', {}])?.isInvalidated,
  ).toBe(false);
});
it('progress never aborts an in-flight page and coalesces repeated updates before a final refresh', async () => {
  vi.useFakeTimers();
  const { client, queue, queryFn } = fixture();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let aborted = false;
  queryFn.mockImplementationOnce(async (context) => {
    context.signal.addEventListener('abort', () => {
      aborted = true;
    });
    await gate;
    return { ids: ['new'], nextCursor: 'next' };
  });
  queue.schedule('PHOTO', false);
  await vi.advanceTimersByTimeAsync(0);
  expect(queryFn).toHaveBeenCalledTimes(1);
  queue.schedule('PHOTO', false);
  queue.schedule('PHOTO', false);
  await vi.advanceTimersByTimeAsync(1500);
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(aborted).toBe(false);
  queue.schedule('PHOTO', true);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(aborted).toBe(false);
  expect(queryFn).toHaveBeenCalledTimes(2);
  expect(client.getQueryState(['eagle', 'owner', 'PHOTO', 'assets', 'ALL', {}])?.fetchStatus).toBe(
    'idle',
  );
});
it('disposal cannot recreate a cleared private query after waiting for its fetch', async () => {
  const { client, queue, key, queryFn } = fixture();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  queryFn.mockImplementationOnce(async () => {
    await gate;
    return { ids: ['private'], nextCursor: 'next' };
  });
  queue.schedule('PHOTO', false);
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  queue.schedule('PHOTO', true);
  queue.dispose();
  client.clear();
  finish();
  await Promise.resolve();
  expect(client.getQueryData(key)).toBeUndefined();
});
