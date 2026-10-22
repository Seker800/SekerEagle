import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createEagleQueryKeys } from './eagle-query-keys';
import { useEagleLibraryCount } from './useEagleLibraryCount';

const state = vi.hoisted(() => ({
  mode: 'MATERIAL' as 'MATERIAL' | 'PHOTO',
  material: vi.fn(),
  photo: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    api: { countEagleAssets: state.mode === 'PHOTO' ? state.photo : state.material },
  }),
}));
beforeEach(() => {
  state.mode = 'MATERIAL';
  state.material.mockReset().mockResolvedValue({ count: 1000 });
  state.photo.mockReset().mockResolvedValue({ count: 72000 });
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    ({ owner, privateVisible, revision }) =>
      useEagleLibraryCount(
        'token',
        createEagleQueryKeys(owner, state.mode),
        privateVisible,
        revision,
      ),
    { wrapper, initialProps: { owner: 'owner', privateVisible: false, revision: 0 } },
  );
  return { ...hook, client };
}
it('does not replace a pending total with the previous mode total or a late response', async () => {
  let resolve!: (value: { count: number }) => void;
  state.material.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = setup();
  expect(hook.result.current.data).toBeUndefined();
  state.mode = 'PHOTO';
  hook.rerender({ owner: 'owner', privateVisible: false, revision: 0 });
  await waitFor(() => expect(hook.result.current.data).toBe(72000));
  await act(async () => resolve({ count: 1000 }));
  expect(hook.result.current.data).toBe(72000);
  state.mode = 'MATERIAL';
  hook.rerender({ owner: 'owner', privateVisible: false, revision: 0 });
  await waitFor(() => expect(hook.result.current.data).toBe(1000));
  hook.unmount();
});
it('refreshes the total on the same invalidation used after import, deletion and restore', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.data).toBe(1000));
  expect(state.material).toHaveBeenCalledWith('token', { version: 2, conditions: [] });
  state.material.mockResolvedValue({ count: 1001 });
  await act(async () => {
    await hook.client.invalidateQueries({ queryKey: createEagleQueryKeys('owner').assets });
  });
  await waitFor(() => expect(hook.result.current.data).toBe(1001));
  hook.unmount();
});
it('does not expose the previous owner or private visibility total while awaiting a new count', async () => {
  const hook = setup();
  await waitFor(() => expect(hook.result.current.data).toBe(1000));
  state.material.mockReturnValue(new Promise(() => {}));
  hook.rerender({ owner: 'other-owner', privateVisible: false, revision: 0 });
  expect(hook.result.current.data).toBeUndefined();
  hook.rerender({ owner: 'owner', privateVisible: true, revision: 1 });
  expect(hook.result.current.data).toBeUndefined();
  hook.unmount();
});
