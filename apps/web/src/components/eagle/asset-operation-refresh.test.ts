import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AssetOperationRefresher } from './asset-operation-refresh';
const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
  vi.useRealTimers();
});
function fixture(view = 'ALL') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const queue = new AssetOperationRefresher(client, 'owner');
  disposals.push(
    () => queue.dispose(),
    () => client.clear(),
  );
  const key = ['eagle', 'owner', 'PHOTO', 'assets', view, {}];
  const queryFn = vi.fn(async (_context: { signal: AbortSignal; pageParam: unknown }) => ({
    ids: ['current'],
    nextCursor: 'next',
  }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn,
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor,
    initialData: {
      pages: Array.from({ length: 12 }, (_, i) => ({ ids: [`old-${i}`], nextCursor: 'next' })),
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
  expect(queryFn.mock.calls[0]![0].pageParam).toBe('0');
  expect(
    client.getQueryState(['eagle', 'owner', 'MATERIAL', 'assets', 'ALL', {}])?.isInvalidated,
  ).toBe(false);
  queue.schedule('PHOTO', true);
  await vi.waitFor(() => expect(tagFn).toHaveBeenCalledTimes(1));
});

it('a replacement refetch during the wait cannot restore an obsolete multi-page cursor chain', async () => {
  const { client, queue, key, queryFn } = fixture();
  let releaseFirst!: () => void, releaseSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  queryFn.mockImplementationOnce(async ({ signal }) => {
    void signal;
    await firstGate;
    return { ids: ['first'], nextCursor: 'next' };
  });
  queryFn.mockImplementationOnce(async () => {
    await secondGate;
    return { ids: ['replacement'], nextCursor: 'next' };
  });
  const first = client.refetchQueries({ queryKey: key, exact: true });
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
  queue.schedule('PHOTO', false);
  const replacement = client.invalidateQueries({ queryKey: key, exact: true });
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  releaseSecond();
  releaseFirst();
  await Promise.all([first, replacement]);
  await vi.waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe('idle'));
  await vi.waitFor(() =>
    expect(client.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(1),
  );
  expect(queryFn.mock.lastCall![0].pageParam).toBe('0');
});

it('removeQueries without disposal cannot recreate an old private query or touch another owner', async () => {
  const { client, queue, key, queryFn } = fixture('PRIVATE');
  const foreign = ['eagle', 'foreign', 'PHOTO', 'assets', 'ALL', {}];
  client.setQueryData(foreign, { pages: [{ ids: ['foreign'] }], pageParams: [''] });
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
  client.removeQueries({ queryKey: key, exact: true });
  finish();
  queue.schedule('PHOTO', true);
  await vi.waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
  expect(client.getQueryState(foreign)?.isInvalidated).toBe(false);
  expect(queryFn).toHaveBeenCalledTimes(1);
});

it('completed refreshes limit intermediate progress to one request per four seconds', async () => {
  vi.useFakeTimers();
  const { queue, queryFn } = fixture();
  queue.schedule('PHOTO', false);
  await vi.advanceTimersByTimeAsync(0);
  expect(queryFn).toHaveBeenCalledTimes(1);
  queue.schedule('PHOTO', false);
  queue.schedule('PHOTO', false);
  await vi.advanceTimersByTimeAsync(3999);
  expect(queryFn).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(queryFn).toHaveBeenCalledTimes(2);
  queue.dispose();
  queue.schedule('PHOTO', true);
  await vi.advanceTimersByTimeAsync(4000);
  expect(queryFn).toHaveBeenCalledTimes(2);
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
