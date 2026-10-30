import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { usePhotoFilterOptions } from './usePhotoFilterOptions';
const mocks = vi.hoisted(() => ({ options: vi.fn(), full: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ ownerId: 'owner', libraryMode: 'PHOTO' }),
}));
vi.mock('../../lib/photo-management-api', () => ({
  getPhotoFacets: async () => ({ cameras: [], lenses: [] }),
  listPhotoPeople: mocks.full,
  listPhotoPeopleOptions: mocks.options,
}));
it('loads paged identity options without fetching person cards or faces', async () => {
  mocks.options.mockImplementation((cursor?: string) =>
    Promise.resolve({
      people: [{ id: cursor ? 'p2' : 'p1', name: cursor ? '第二人' : '第一人' }],
      nextCursor: cursor ? null : 'next',
    }),
  );
  mocks.full.mockResolvedValue({ people: [], nextCursor: null });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => usePhotoFilterOptions(false, true), { wrapper });
  await waitFor(() => expect(mocks.options).toHaveBeenCalledOnce());
  expect(mocks.full).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(view.result.current.fieldOptions.PERSON).toEqual([{ value: 'p1', label: '第一人' }]),
  );
  await act(async () => {
    await view.result.current.people.fetchNextPage();
  });
  await waitFor(() => expect(view.result.current.fieldOptions.PERSON).toHaveLength(2));
  expect(mocks.options.mock.calls[1]?.[0]).toBe('next');
});

it('refreshes identity options when person mutations invalidate the shared people prefix', async () => {
  mocks.options.mockReset();
  mocks.options.mockResolvedValue({people: [{id: 'p1', name: '旧名字'}], nextCursor: null});
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = renderHook(() => usePhotoFilterOptions(false, true), {wrapper});
  await waitFor(() => expect(view.result.current.fieldOptions.PERSON[0]?.label).toBe('旧名字'));
  mocks.options.mockResolvedValue({people: [{id: 'p1', name: '新名字'}], nextCursor: null});
  await act(async () => {await client.invalidateQueries({queryKey: ['eagle', 'owner', 'PHOTO', 'people']});});
  await waitFor(() => expect(view.result.current.fieldOptions.PERSON[0]?.label).toBe('新名字'));
  view.unmount();
  client.clear();
});
