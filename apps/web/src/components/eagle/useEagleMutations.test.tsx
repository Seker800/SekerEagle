import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi, afterEach } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import type { EagleAsset } from '../../lib/eagle-api';
import { createEagleQueryKeys } from './eagle-query-keys';
import { useEagleMutations } from './useEagleMutations';
afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) => Response.json(value);
const asset = (id: string, rowVersion: number) =>
  ({ id, rowVersion, mediaRevision: 1, manualTags: [], renditions: [] }) as EagleAsset;
it('rating writes through existing view details without creating a ghost short key', async () => {
  const client = new QueryClient();
  const keys = createEagleQueryKeys('A');
  const inspector = [...keys.assetDetail('a'), 'ACTIVE'];
  client.setQueryData(inspector, asset('a', 1));
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
  expect(client.getQueryData(keys.assetDetail('a'))).toBeUndefined();
  expect(client.getQueryData<EagleAsset>(inspector)?.rowVersion).toBe(2);
  view.unmount();
  client.clear();
});
