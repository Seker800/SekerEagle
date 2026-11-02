import { createEagleQueryKeys } from './eagle-query-keys';
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
function fixture(view = 'ACTIVE') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, staleTime: Infinity } },
  });
  const key = ['eagle', 'owner', 'PHOTO', 'assets', view, {}];
  const data = {
    pages: Array.from({ length: 12 }, (_, i) => ({
      assetIds: [`a-${i}`, `b-${i}`],
      nextCursor: String(i + 1),
    })),
    pageParams: Array.from({ length: 12 }, (_, i) => String(i)),
  };
  const queryFn = vi.fn(async (_context?: unknown) => ({ assetIds: ['new'], nextCursor: 'next' }));
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
it('reconciles a whole-trash command against every loaded trash page without clearing a later arrival', async () => {
  const f = fixture('TRASH');
  const completed = {
    ...summary('EMPTY_TRASH'),
    completed: 1,
    failed: 0,
    errors: [],
    state: 'COMPLETED' as const,
  };
  f.queryFn.mockImplementation(async () => ({
    assetIds: ['arrived-after-cutoff'],
    nextCursor: 'next',
  }));
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(f.queryFn).toHaveBeenCalledTimes(12);
    const updated = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(updated.pages).toHaveLength(12);
    expect(updated.pages[0].assetIds).toEqual(['arrived-after-cutoff']);
    expect(updated.pageParams).toHaveLength(12);
  } finally {
    f.close();
  }
});
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

it('publishes a completed sixty-thousand image scan without downloading asset membership receipts', async () => {
  const f = fixture();
  mocks.results.mockClear();
  f.cache.operations.begin('op', 'DUPLICATE_SCAN', []);
  const invalidate = vi.spyOn(f.client, 'invalidateQueries');
  await f.refresher.reconcile('PHOTO', {
    ...summary('DUPLICATE_SCAN'),
    total: 60001,
    completed: 60001,
    failed: 0,
    errors: [],
    state: 'COMPLETED',
  });
  expect(mocks.results).not.toHaveBeenCalled();
  expect(f.queryFn).not.toHaveBeenCalled();
  expect(invalidate).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: ['eagle', 'owner', 'PHOTO', 'duplicates'] }),
    expect.anything(),
  );
  f.close();
});

it.each([
  ['TRASH', 'PHOTO', 'TRASH'],
  ['DUPLICATE_CLEANUP', 'PHOTO', 'TRASH'],
  ['RESTORE', 'PHOTO', 'ACTIVE'],
  ['RESTORE', 'PHOTO', 'PRIVATE'],
  ['SEND', 'MATERIAL', 'ACTIVE'],
  ['SEND', 'MATERIAL', 'PRIVATE'],
] as const)(
  'marks an inactive %s destination stale for %s/%s without fetching its pages',
  async (kind, targetMode, view) => {
    const f = fixture();
    const target = createEagleQueryKeys('owner', targetMode).assetList(view, {
      cached: 'inactive',
    });
    const otherOwner = createEagleQueryKeys('other', targetMode).assetList(view, {});
    const unrelatedMode = createEagleQueryKeys(
      'owner',
      targetMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO',
    ).assetList(view, {});
    f.client.setQueryData(target, f.data);
    f.client.setQueryData(otherOwner, f.data);
    f.client.setQueryData(unrelatedMode, f.data);
    const completed = {
      ...summary(kind),
      completed: 2,
      failed: 0,
      errors: [],
      state: 'COMPLETED' as const,
    };
    mocks.results.mockResolvedValue({
      operation: completed,
      revision: 'v1',
      membership: [],
      receipts: [],
      nextCursor: null,
    });
    try {
      await f.refresher.reconcile('PHOTO', completed);
      expect(f.client.getQueryState(target)?.isInvalidated).toBe(true);
      expect(f.client.getQueryData(target)).toEqual(f.data);
      expect(f.client.getQueryState(otherOwner)?.isInvalidated).toBe(false);
      if (kind !== 'SEND') expect(f.client.getQueryState(unrelatedMode)?.isInvalidated).toBe(false);
      if (kind === 'TRASH' || kind === 'DUPLICATE_CLEANUP')
        expect(f.queryFn).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

it('adds newly trashed members through only the active trash first window while retaining every page', async () => {
  const f = fixture('TRASH');
  const completed = {
    ...summary('TRASH'),
    completed: 2,
    failed: 0,
    errors: [],
    state: 'COMPLETED' as const,
  };
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [{ id: 'new', rowVersion: 2, state: 'TRASH' }],
    receipts: [{ assetIds: ['new'], status: 'COMPLETED', errorCode: null }],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(f.queryFn).toHaveBeenCalledTimes(1);
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages).toHaveLength(12);
    expect(current.pageParams).toEqual(f.data.pageParams);
    expect(current.pages[0].assetIds).toEqual(['new', 'a-0', 'b-0']);
  } finally {
    f.close();
  }
});

it('retains a failed destination for the next terminal reconciliation without rereading receipts', async () => {
  const f = fixture('TRASH');
  mocks.results.mockReset().mockResolvedValue({
    operation: summary(),
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  f.queryFn.mockRejectedValue(new Error('offline'));
  try {
    await f.refresher.reconcile('PHOTO', summary());
    expect(f.queryFn).toHaveBeenCalledTimes(3);
    expect(f.client.getQueryState(f.key)?.isInvalidated).toBe(true);
    expect(f.client.getQueryData(f.key)).toEqual(f.data);
    f.queryFn.mockResolvedValue({ assetIds: ['new'], nextCursor: 'next' });
    await f.refresher.reconcile('PHOTO', summary());
    expect(f.queryFn).toHaveBeenCalledTimes(4);
    expect(mocks.results).toHaveBeenCalledTimes(1);
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages).toHaveLength(12);
    expect(current.pageParams).toEqual(f.data.pageParams);
    expect(current.pages[0].assetIds).toEqual(['new', 'a-0', 'b-0']);
    f.refresher.schedule('PHOTO', false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.queryFn).toHaveBeenCalledTimes(4);
  } finally {
    f.close();
  }
});

it('prevents an older in-flight infinite response from overwriting the destination merge', async () => {
  const f = fixture('TRASH');
  let release!: (value: { assetIds: string[]; nextCursor: string }) => void;
  f.queryFn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  mocks.results.mockResolvedValue({
    operation: summary(),
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    const oldFetch = f.client.refetchQueries({ queryKey: f.key, exact: true });
    await vi.waitFor(() => expect(f.queryFn).toHaveBeenCalledTimes(1));
    await f.refresher.reconcile('PHOTO', summary());
    release({ assetIds: [], nextCursor: '' });
    await oldFetch;
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages).toHaveLength(12);
    expect(current.pageParams).toEqual(f.data.pageParams);
    expect(current.pages[0].assetIds).toEqual(['new', 'a-0', 'b-0']);
    expect(f.queryFn).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});

it('retains a second destination intent arriving while the first window is in flight', async () => {
  const f = fixture('TRASH');
  let release!: (value: { assetIds: string[]; nextCursor: string }) => void;
  f.queryFn.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  f.queryFn.mockResolvedValue({ assetIds: ['second', 'new'], nextCursor: 'next' });
  mocks.results.mockReset().mockImplementation(async (id: string) => ({
    operation: { ...summary(), id },
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  }));
  try {
    const first = f.refresher.reconcile('PHOTO', summary());
    await vi.waitFor(() => expect(f.queryFn).toHaveBeenCalledTimes(1));
    const second = f.refresher.reconcile('PHOTO', { ...summary(), id: 'second-op' });
    await vi.waitFor(() => expect(mocks.results).toHaveBeenCalledTimes(2));
    release({ assetIds: ['new'], nextCursor: 'next' });
    await Promise.all([first, second]);
    expect(f.queryFn).toHaveBeenCalledTimes(2);
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages[0].assetIds).toEqual(['second', 'new', 'a-0', 'b-0']);
    expect(current.pages).toHaveLength(12);
    expect(current.pageParams).toEqual(f.data.pageParams);
  } finally {
    f.close();
  }
});

it('updates metadata cards across loaded pages once without replaying pages or changing their cursors', async () => {
  const f = fixture();
  const facts = vi.fn(async (_token: string, ids: readonly string[]) =>
    ids.map((id) => ({
      id,
      displayName: 'updated',
      rowVersion: 2,
      updatedAt: '2026-11-02T00:00:00Z',
      mediaRevision: 1,
    })),
  );
  const { createEagleApi } = await import('../../lib/eagle-api');
  vi.spyOn(await import('../../lib/eagle-api'), 'createEagleApi').mockReturnValue({
    ...createEagleApi('PHOTO'),
    listEagleAssetFacts: facts,
  } as never);
  const completed = {
    ...summary('METADATA_COMMAND'),
    failed: 0,
    errors: [],
    completed: 2,
    state: 'COMPLETED' as const,
  };
  f.cache.beginOperation(completed.id, completed.kind, []);
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(facts).toHaveBeenCalledOnce();
    expect(facts.mock.calls[0][1]).toContain('a-11');
    expect(f.cache.store.get('a-11')?.displayName).toBe('updated');
    expect(f.client.getQueryData(f.key)).toEqual(f.data);
    expect(f.queryFn).not.toHaveBeenCalled();
    await f.refresher.reconcile('PHOTO', completed);
    expect(facts).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
    f.close();
  }
});

it('removes inaccessible metadata command cards and details without discarding unrelated pages', async () => {
  const f = fixture();
  const { createEagleApi } = await import('../../lib/eagle-api');
  vi.spyOn(await import('../../lib/eagle-api'), 'createEagleApi').mockReturnValue({
    ...createEagleApi('PHOTO'),
    listEagleAssetFacts: vi.fn(async () => []),
  } as never);
  const detailKey = createEagleQueryKeys('owner', 'PHOTO').assetDetail('a-0', 'ACTIVE');
  f.client.setQueryData(detailKey, { id: 'a-0' });
  const completed = {
    ...summary('METADATA_COMMAND'),
    completed: 2,
    failed: 0,
    errors: [],
    state: 'COMPLETED' as const,
  };
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(f.client.getQueryData(detailKey)).toBeUndefined();
    const current = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(current.pages).toHaveLength(12);
    expect(current.pageParams).toEqual(f.data.pageParams);
    expect(current.pages.flatMap((page) => page.assetIds)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    f.close();
  }
});

it('merges newly rendered copies from one destination window while retaining every loaded page', async () => {
  const f = fixture();
  const { createEagleApi } = await import('../../lib/eagle-api');
  vi.spyOn(await import('../../lib/eagle-api'), 'createEagleApi').mockReturnValue({
    ...createEagleApi('PHOTO'),
    listEagleAssetFacts: vi.fn(async (_token, ids: string[]) =>
      ids.map((id) => ({ id, updatedAt: '2026-11-02', rowVersion: 2, mediaRevision: 1 })),
    ),
  } as never);
  const completed = {
    ...summary('BACKGROUND_COMMAND'),
    commandType: 'BATCH_EDIT_RENDER',
    completed: 2,
    failed: 0,
    errors: [],
    state: 'COMPLETED' as const,
  };
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(f.queryFn).toHaveBeenCalledOnce();
    const data = f.client.getQueryData<typeof f.data>(f.key)!;
    expect(data.pages).toHaveLength(12);
    expect(data.pages[0].assetIds).toContain('new');
    expect(data.pages[11]).toEqual(f.data.pages[11]);
  } finally {
    vi.restoreAllMocks();
    f.close();
  }
});

it('refreshes the scoped task-center family counts after command execution', async () => {
  const f = fixture();
  const read = vi.fn(async () => ({ groups: [] }));
  const observer = new QueryObserver(f.client, {
    queryKey: ['task-center', 'owner', 'PHOTO', false, 'ACTIVE'],
    queryFn: read,
    initialData: { groups: [] },
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => {});
  const completed = {
    ...summary('BACKGROUND_COMMAND'),
    commandType: 'TASK_FAMILY_RETRY',
    completed: 1,
    failed: 0,
    errors: [],
    state: 'COMPLETED' as const,
  };
  mocks.results.mockResolvedValue({
    operation: completed,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  const { createEagleApi } = await import('../../lib/eagle-api');
  vi.spyOn(await import('../../lib/eagle-api'), 'createEagleApi').mockReturnValue({
    ...createEagleApi('PHOTO'),
    listEagleAssetFacts: vi.fn(async () => []),
  } as never);
  try {
    await f.refresher.reconcile('PHOTO', completed);
    expect(read).toHaveBeenCalledOnce();
  } finally {
    vi.restoreAllMocks();
    stop();
    f.close();
  }
});


it('refreshes photo-stack topology on every loaded page while retaining IDs and cursor history', async () => {
 const f=fixture();
 const freshStack={id:'fresh-stack',assetIds:['a-11','b-11']};
 f.queryFn.mockResolvedValue({assetIds:['moved'],nextCursor:'different',photoStacks:[freshStack]} as never);
 const {createEagleApi}=await import('../../lib/eagle-api');
 vi.spyOn(await import('../../lib/eagle-api'),'createEagleApi').mockReturnValue({...createEagleApi('PHOTO'),listEagleAssetFacts:vi.fn(async(_token,ids:string[])=>ids.map(id=>({id,updatedAt:'2026-11-02',rowVersion:2,mediaRevision:1})))} as never);
 const completed={...summary('METADATA_COMMAND'),commandType:'PHOTO_GROUP_UPDATE',completed:1,failed:0,errors:[],state:'COMPLETED' as const};
 mocks.results.mockResolvedValue({operation:completed,revision:'v1',membership:[],receipts:[],nextCursor:null});
 try{
  await f.refresher.reconcile('PHOTO',completed);
  expect(f.queryFn).toHaveBeenCalledTimes(12);
  expect(f.queryFn.mock.calls.map(([context])=>(context as {pageParam:string}).pageParam)).toEqual(f.data.pageParams);
  const data=f.client.getQueryData<typeof f.data>(f.key)!;
  expect(data.pages).toHaveLength(12);expect(data.pageParams).toEqual(f.data.pageParams);
  expect(data.pages.map(page=>page.assetIds)).toEqual(f.data.pages.map(page=>page.assetIds));
  expect(data.pages[11]).toEqual({...f.data.pages[11],photoStacks:[freshStack]});
 }finally{vi.restoreAllMocks();f.close();}
});

it('evicts newly inaccessible details opened outside loaded list pages and clears an active observer before removing its cache', async () => {
 const f=fixture();const key=createEagleQueryKeys('owner','PHOTO').assetDetail('outside','ACTIVE');
 const observer=new QueryObserver(f.client,{queryKey:key,queryFn:async()=>({id:'outside'}),initialData:{id:'outside'},staleTime:Infinity});
 const stop=observer.subscribe(()=>{});
 const {createEagleApi}=await import('../../lib/eagle-api');
 const facts=vi.fn(async(_token,ids:string[])=>ids.filter(id=>id!=='outside').map(id=>({id,updatedAt:'2026-11-02',rowVersion:2,mediaRevision:1})));
 vi.spyOn(await import('../../lib/eagle-api'),'createEagleApi').mockReturnValue({...createEagleApi('PHOTO'),listEagleAssetFacts:facts} as never);
 const completed={...summary('METADATA_COMMAND'),commandType:'PRIVACY_SETTINGS',completed:1,failed:0,errors:[],state:'COMPLETED' as const};
 mocks.results.mockResolvedValue({operation:completed,revision:'v1',membership:[],receipts:[],nextCursor:null});
 try{await f.refresher.reconcile('PHOTO',completed);expect(facts.mock.calls[0][1]).toContain('outside');expect(observer.getCurrentResult().data).toBeNull();expect(f.client.getQueryData(key)).toBeUndefined();}
 finally{vi.restoreAllMocks();stop();f.close();}
});
