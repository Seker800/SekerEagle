import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AssetOperationRefresher } from './asset-operation-refresh';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import type { AssetOperationSummary } from '@sekereagle/library-core';
const mocks = vi.hoisted(() => ({ results: vi.fn() }));
vi.mock('../../lib/asset-operations-api', () => ({ createAssetOperationsApi: () => mocks }));
const summary = (kind: AssetOperationSummary['kind'] = 'TRASH'): AssetOperationSummary => ({
  id: 'op',
  kind,
  libraryMode: 'PHOTO',
  total: 2,
  completed: 1,
  failed: 1,
  queued: 0,
  running: 0,
  cancelled: 0,
  state: 'STOPPED',
  errors: [{ code: 'ASSET_CHANGED', count: 1 }],
});
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const key = ['eagle', 'owner', 'PHOTO', 'assets', 'ACTIVE', {}];
  const data = {
    pages: Array.from({ length: 12 }, (_, i) => ({
      assetIds: [`a-${i}`, `b-${i}`],
      nextCursor: String(i + 1),
    })),
    pageParams: Array.from({ length: 12 }, (_, i) => String(i)),
  };
  const queryFn = vi.fn(async () => ({ assetIds: ['new'], nextCursor: 'next' }));
  const observer = new InfiniteQueryObserver(client, {
    queryKey: key,
    queryFn,
    initialPageParam: '0',
    getNextPageParam: (page) => page.nextCursor,
    initialData: data,
  });
  const unsubscribe = observer.subscribe(() => {});
  const cache = getEagleWorkspaceCache(client, 'owner', 'PHOTO');
  const refresher = new AssetOperationRefresher(client, 'owner');
  return {
    client,
    key,
    data,
    queryFn,
    cache,
    refresher,
    close: () => {
      refresher.dispose();
      unsubscribe();
      client.clear();
    },
  };
}
it('applies partial deletion receipts without a single list GET, retaining all twelve pages and cursors', async () => {
  const f = fixture();
  f.cache.operations.begin('op', 'TRASH', ['a-0', 'b-0']);
  mocks.results.mockResolvedValue({
    operation: summary(),
    revision: 'v1',
    membership: [
      { id: 'a-0', rowVersion: 2, state: 'TRASH' },
      { id: 'b-0', rowVersion: 1, state: 'ACTIVE' },
    ],
    nextCursor: null,
    receipts: [
      { assetIds: ['a-0'], status: 'COMPLETED', errorCode: null },
      { assetIds: ['b-0'], status: 'FAILED', errorCode: 'ASSET_CHANGED' },
    ],
  });
  try {
    await f.refresher.reconcile('PHOTO', summary());
    expect(f.queryFn).not.toHaveBeenCalled();
    expect(f.client.getQueryData(f.key)).toEqual(f.data);
    expect(f.cache.operations.visible('a-0', false)).toBe(false);
    expect(f.cache.operations.visible('b-0', false)).toBe(true);
    expect(f.cache.operations.entries[0]?.failedIds).toEqual(['b-0']);
  } finally {
    f.close();
  }
});
it('reads every transport page once and never repeats an already applied terminal snapshot', async () => {
  const f = fixture();
  mocks.results.mockReset();
  mocks.results
    .mockResolvedValueOnce({
      operation: summary(),
      revision: 'stable',
      membership: [],
      nextCursor: 512,
      receipts: [{ assetIds: ['a-0'], status: 'COMPLETED', errorCode: null }],
    })
    .mockResolvedValueOnce({
      operation: summary(),
      revision: 'stable',
      membership: [],
      nextCursor: null,
      receipts: [{ assetIds: ['b-0'], status: 'FAILED', errorCode: 'ASSET_CHANGED' }],
    });
  try {
    await f.refresher.reconcile('PHOTO', summary());
    await f.refresher.reconcile('PHOTO', summary());
    expect(mocks.results).toHaveBeenCalledTimes(2);
    expect(mocks.results.mock.calls[1]?.[1]).toEqual({ cursor: 512, revision: 'stable' });
  } finally {
    f.close();
  }
});
it('coalesces metadata updates and never refetches asset pages or a different owner', async () => {
  const f = fixture();
  const count = vi.fn(async () => ({ count: 10 }));
  const observer = new QueryObserver(f.client, {
    queryKey: ['eagle', 'owner', 'PHOTO', 'assets', 'library-count', false, 0],
    queryFn: count,
    initialData: { count: 11 },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  f.client.setQueryData(['eagle', 'other', 'PHOTO', 'manual-tags'], []);
  try {
    for (let i = 0; i < 100; i++) f.refresher.schedule('PHOTO', false);
    await vi.waitFor(() => expect(count).toHaveBeenCalledTimes(1));
    expect(f.queryFn).not.toHaveBeenCalled();
    expect(f.client.getQueryState(['eagle', 'other', 'PHOTO', 'manual-tags'])?.isInvalidated).toBe(
      false,
    );
  } finally {
    unsubscribe();
    f.close();
  }
});
it('ignores a late private result after the workspace is cleared', async () => {
  const f = fixture();
  let release!: (value: unknown) => void;
  mocks.results.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const running = f.refresher.reconcile('PHOTO', summary());
  f.cache.operations.clear();
  release({
    operation: summary(),
    revision: 'v1',
    membership: [
      { id: 'a-0', rowVersion: 2, state: 'TRASH' },
      { id: 'b-0', rowVersion: 1, state: 'ACTIVE' },
    ],
    nextCursor: null,
    receipts: [{ assetIds: ['a-0'], status: 'COMPLETED', errorCode: null }],
  });
  await running;
  expect(f.cache.operations.visible('a-0', false)).toBe(true);
  expect(f.queryFn).not.toHaveBeenCalled();
  f.close();
});
it('refreshes only the first active window after restoration and retains every existing page', async () => {
  const f = fixture();
  mocks.results.mockResolvedValue({
    operation: summary('RESTORE'),
    revision: 'v1',
    membership: [
      { id: 'a-0', rowVersion: 2, state: 'TRASH' },
      { id: 'b-0', rowVersion: 1, state: 'ACTIVE' },
    ],
    nextCursor: null,
    receipts: [{ assetIds: ['new'], status: 'COMPLETED', errorCode: null }],
  });
  try {
    await f.refresher.reconcile('PHOTO', summary('RESTORE'));
    expect(f.queryFn).toHaveBeenCalledTimes(1);
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages).toHaveLength(12);
    expect(current.pages[0]?.assetIds).toEqual(['new', 'a-0', 'b-0']);
    expect(current.pageParams).toEqual(f.data.pageParams);
  } finally {
    f.close();
  }
});

it('keeps the fresh restored photo-stack cover instead of an older cached copy', async () => {
  const f = fixture();
  const oldStack = { id: 'stack', assetIds: ['a', 'b'], cover: { id: 'a' } };
  const freshStack = { ...oldStack, cover: { id: 'b' } };
  f.client.setQueryData(f.key, {
    ...f.data,
    pages: [{ ...f.data.pages[0], photoStacks: [oldStack] }, ...f.data.pages.slice(1)],
  });
  f.queryFn.mockResolvedValue({
    assetIds: ['new'],
    nextCursor: 'next',
    photoStacks: [freshStack],
  } as never);
  mocks.results.mockResolvedValue({
    operation: summary('RESTORE'),
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', summary('RESTORE'));
    const data = f.client.getQueryData<{ pages: Array<{ photoStacks: (typeof oldStack)[] }> }>(
      f.key,
    )!;
    expect(data.pages[0]?.photoStacks).toEqual([freshStack]);
    expect(data.pages).toHaveLength(12);
  } finally {
    f.close();
  }
});

it('publishes a completed sixty-thousand image scan without downloading asset membership receipts',async()=>{
 const f=fixture();mocks.results.mockClear();f.cache.operations.begin('op','DUPLICATE_SCAN',[]);
 const invalidate=vi.spyOn(f.client,'invalidateQueries');await f.refresher.reconcile('PHOTO',{...summary('DUPLICATE_SCAN'),total:60001,completed:60001,failed:0,errors:[],state:'COMPLETED'});
 expect(mocks.results).not.toHaveBeenCalled();expect(f.queryFn).not.toHaveBeenCalled();expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({queryKey:['eagle','owner','PHOTO','duplicates']}),expect.anything());f.close();
});
