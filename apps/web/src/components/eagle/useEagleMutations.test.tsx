import { makeEagleAsset } from '../../test/eagle-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi, afterEach } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import type { EagleAsset } from '../../lib/eagle-api';
import { createEagleQueryKeys } from './eagle-query-keys';
import { useEagleMutations } from './useEagleMutations';
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) => Response.json(value);
const asset = (id: string, rowVersion: number) => makeEagleAsset({ id, rowVersion });
it('rating writes through existing view details without creating a ghost short key', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('A');
  const inspector = [...keys.assetDetailPrefix('a'), 'ACTIVE'];
  client.setQueryData(inspector, { ...asset('a', 1), mediaRevision: 3 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ ...asset('a', 2), rating: 5 })),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="A" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useEagleMutations('', keys, {
        onMetadataSaved: vi.fn(),
        onBatchTagsApplied: vi.fn(),
        onAssetPrivacyChanged: vi.fn(),
        onOperationStarted: vi.fn(),
        onSmartFolderCreated: vi.fn(),
        onSmartFolderUpdated: vi.fn(),
      }),
    { wrapper },
  );
  await act(async () => {
    await view.result.current.ratingMutation.mutateAsync({
      assets: [{ assetId: 'a', rowVersion: 1 }],
      rating: 5,
    });
  });
  expect(client.getQueryData(keys.assetDetailPrefix('a'))).toBeUndefined();
  expect(client.getQueryData<EagleAsset>(inspector)?.rowVersion).toBe(2);
  expect(client.getQueryData<EagleAsset>(inspector)?.mediaRevision).toBe(3);
  view.unmount();
  client.clear();
});

it('partial tag failures drain writes, refresh committed results, and retry only unresolved tags', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('A');
  const tags = Array.from({ length: 5 }, (_, i) => ({
    id: `tag-${i}`,
    name: `tag-${i}`,
    rowVersion: 1,
    color: null,
    groupId: null,
    groupIds: [],
    isStarred: false,
    assetCount: 0,
    lastUsedAt: null,
    pinyin: '',
    pinyinInitials: '',
  }));
  client.setQueryData(keys.manualTags, tags);
  client.setQueryData(keys.assetList('ACTIVE', {}), {});
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const fetchMock = vi.fn(async (path: RequestInfo | URL) => {
    if (path === '/api/eagle/tags/tag-0')
      return new Response(JSON.stringify({ message: 'failed' }), { status: 503 });
    await gate;
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="A" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useEagleMutations('', keys, {
        onMetadataSaved: vi.fn(),
        onBatchTagsApplied: vi.fn(),
        onAssetPrivacyChanged: vi.fn(),
        onOperationStarted: vi.fn(),
        onSmartFolderCreated: vi.fn(),
        onSmartFolderUpdated: vi.fn(),
      }),
    { wrapper },
  );
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view.result.current.deleteTagsMutation.mutateAsync(tags).catch((e: unknown) => e);
  });
  await waitFor(() => expect(view.result.current.deleteTagsMutation.isPending).toBe(true));
  expect(fetchMock).toHaveBeenCalledTimes(4);
  await act(async () => {
    release();
    await pending;
  });
  await waitFor(() =>
    expect(view.result.current.tagBatchFailure?.items.map((tag) => tag.id)).toEqual([
      'tag-0',
      'tag-4',
    ]),
  );
  expect(view.result.current.tagBatchFailure?.completed).toBe(3);
  expect(client.getQueryState(keys.assetList('ACTIVE', {}))?.isInvalidated).toBe(true);
  fetchMock.mockImplementation(async () => json({}));
  await act(async () => {
    view.result.current.tagBatchFailure?.retry();
  });
  await vi.waitFor(() => expect(view.result.current.deleteTagsMutation.isSuccess).toBe(true));
  expect(fetchMock.mock.calls.slice(4).map(([path]) => path)).toEqual([
    '/api/eagle/tags/tag-0',
    '/api/eagle/tags/tag-4',
  ]);
  view.unmount();
  client.clear();
});

it('releases a queued batch tag mutation without waiting for list reads or desktop cache and tracks its receipt', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('A');
  const summary = {
    id: 'metadata-command',
    kind: 'METADATA_COMMAND',
    libraryMode: 'MATERIAL',
    total: 2,
    completed: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    queued: 2,
    state: 'QUEUED',
    errors: [],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(summary)),
  );
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockReturnValue(new Promise(() => undefined));
  const applied = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="A" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useEagleMutations('', keys, {
        onMetadataSaved: vi.fn(),
        onBatchTagsApplied: applied,
        onAssetPrivacyChanged: vi.fn(),
        onOperationStarted: vi.fn(),
        onSmartFolderCreated: vi.fn(),
        onSmartFolderUpdated: vi.fn(),
      }),
    { wrapper },
  );
  await act(async () => {
    expect(
      await view.result.current.batchTagMutation.mutateAsync({
        assetIds: ['a', 'b'],
        addTagIds: ['tag'],
      }),
    ).toEqual(summary);
  });
  expect(view.result.current.batchTagMutation.isPending).toBe(false);
  expect(applied).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: keys.operations });
  view.unmount();
  client.clear();
});

it('chains a rapid metadata edit to its own accepted rating receipt without inventing row versions or waiting for execution', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('A');
  let count = 0;
  const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) =>
    json({
      id: `command-${++count}`,
      kind: 'METADATA_COMMAND',
      commandType: 'ASSET_UPDATE',
      libraryMode: 'MATERIAL',
      total: 1,
      completed: 0,
      failed: 0,
      cancelled: 0,
      running: 0,
      queued: 1,
      state: 'QUEUED',
      errors: [],
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(client, 'invalidateQueries').mockReturnValue(new Promise(() => undefined));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="A" libraryMode="MATERIAL">
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useEagleMutations('', keys, {
        onMetadataSaved: vi.fn(),
        onBatchTagsApplied: vi.fn(),
        onAssetPrivacyChanged: vi.fn(),
        onOperationStarted: vi.fn(),
        onSmartFolderCreated: vi.fn(),
        onSmartFolderUpdated: vi.fn(),
      }),
    { wrapper },
  );
  await act(async () => {
    await view.result.current.ratingMutation.mutateAsync({
      assets: [{ assetId: 'a', rowVersion: 1 }],
      rating: 5,
    });
  });
  await act(async () => {
    await view.result.current.metadataMutation.mutateAsync({
      assetId: 'a',
      assets: [{ assetId: 'a', rowVersion: 1 }],
      input: { description: 'new description' },
      revision: 1,
    });
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
    description: 'new description',
    rowVersion: 1,
    predecessorOperationIds: ['command-1'],
  });
  expect(view.result.current.metadataMutation.isPending).toBe(false);
  await act(async () => {
    await view.result.current.ratingMutation.mutateAsync({
      assets: [{ assetId: 'a', rowVersion: 1 }],
      rating: 4,
    });
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(fetchMock.mock.calls[2][1]?.body as string)).toEqual({
    rating: 4,
    rowVersion: 1,
    predecessorOperationIds: ['command-2'],
  });

  view.unmount();
  client.clear();
});
