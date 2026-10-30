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
        onOperationQueued: vi.fn(),
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
        onOperationQueued: vi.fn(),
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
