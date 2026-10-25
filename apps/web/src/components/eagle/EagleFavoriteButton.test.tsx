import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { EagleFavoriteButton, setLibraryFavorite } from './EagleFavoriteButton';
import type { EagleAssetListItem } from '../../lib/eagle-api';

const api = vi.hoisted(() => ({
  listEagleManualTags: vi.fn(),
  createEagleManualTag: vi.fn(),
  getEaglePrivacySettings: vi.fn(),
  batchChangeEagleManualTags: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api, ownerId: 'owner', libraryMode: 'PHOTO' }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  api.listEagleManualTags.mockResolvedValue([{ id: 'favorite', name: '收藏' }]);
  api.getEaglePrivacySettings.mockResolvedValue({ tagIds: [] });
  api.batchChangeEagleManualTags.mockResolvedValue({});
});
const assets = [
  { id: 'one', manualTags: [{ id: 'favorite', name: '收藏' }, { id: 'other', name: '旅行' }] },
  { id: 'two', manualTags: [] },
] as unknown as EagleAssetListItem[];
function show(items = assets) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EagleFavoriteButton assets={items} role="menuitem" />
    </QueryClientProvider>,
  );
}
it('favorites a mixed selection and removes only the favorite tag on the second click', async () => {
  show();
  fireEvent.click(screen.getByRole('menuitem', { name: '收藏' }));
  const remove = await screen.findByRole('menuitem', { name: '已收藏' });
  await waitFor(() => expect(remove).not.toBeDisabled());
  expect(api.batchChangeEagleManualTags).toHaveBeenLastCalledWith('', {
    assetIds: ['one', 'two'], addTagIds: ['favorite'], removeTagIds: [],
  });
  fireEvent.click(remove);
  await screen.findByRole('menuitem', { name: '收藏' });
  expect(api.batchChangeEagleManualTags).toHaveBeenLastCalledWith('', {
    assetIds: ['one', 'two'], addTagIds: [], removeTagIds: ['favorite'],
  });
});
it('keeps the current state on failure and permits retry', async () => {
  api.batchChangeEagleManualTags.mockRejectedValueOnce(new Error('offline'));
  show();
  fireEvent.click(screen.getByRole('menuitem', { name: '收藏' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(screen.getByRole('menuitem', { name: '收藏' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('menuitem', { name: '收藏' }));
  await screen.findByRole('menuitem', { name: '已收藏' });
});
it('reuses the winner when another client creates the same tag concurrently', async () => {
  api.listEagleManualTags.mockResolvedValueOnce([]);
  api.createEagleManualTag.mockRejectedValueOnce(Object.assign(new Error('exists'), { status: 409 }));
  await setLibraryFavorite(api, ['one'], true);
  expect(api.batchChangeEagleManualTags).toHaveBeenCalledOnce();
});
it('does not create a tag while removing or attach a private tag', async () => {
  api.listEagleManualTags.mockResolvedValueOnce([]);
  await setLibraryFavorite(api, ['one'], false);
  expect(api.createEagleManualTag).not.toHaveBeenCalled();
  api.getEaglePrivacySettings.mockResolvedValue({ tagIds: ['favorite'] });
  await expect(setLibraryFavorite(api, ['one'], true)).rejects.toThrow('私密');
  expect(api.batchChangeEagleManualTags).not.toHaveBeenCalled();
});
