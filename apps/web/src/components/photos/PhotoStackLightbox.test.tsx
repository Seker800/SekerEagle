import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EagleAssetListItem, EaglePhotoStack } from '../../lib/eagle-api';
import { PhotoStackLightbox } from './PhotoStackLightbox';
const { fetchAsset, changeGroup } = vi.hoisted(() => ({ fetchAsset: vi.fn(), changeGroup: vi.fn() }));
vi.mock('../../lib/library-workspace', () => ({ useLibraryWorkspace: () => ({ ownerId: 'owner', libraryMode: 'PHOTO', api: { getEagleAsset: fetchAsset } }) }));
vi.mock('../../lib/photo-management-api', () => ({ updatePhotoGroup: changeGroup }));
vi.mock('openseadragon', () => ({ default: () => ({ addHandler() {}, destroy() {}, open() {} }) }));
const cover = { id: 'a', libraryMode: 'PHOTO', displayName: 'First', originalName: 'first.jpg', mimeType: 'image/jpeg', format: 'jpeg', width: 1000, height: 800, mediaRevision: 1, lifecycleStatus: 'READY', renditions: [{ id: 'thumb-a', kind: 'THUMBNAIL', revision: 1, width: 240, height: 192, mimeType: 'image/jpeg' }], manualTags: [] } as unknown as EagleAssetListItem;
const second = { ...cover, id: 'b', displayName: 'Second', renditions: [{ ...cover.renditions[0]!, id: 'thumb-b' }] };
const stack: EaglePhotoStack = { id: 'stack', bestAssetId: 'a', bestSelectedByUser: false, assetIds: ['a', 'b'], cover };
beforeEach(() => { fetchAsset.mockReset().mockResolvedValue(second); changeGroup.mockReset().mockResolvedValue({}); });
function setup() {
 const onEdit = vi.fn();
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 render(<QueryClientProvider client={client}><PhotoStackLightbox stack={stack} onClose={vi.fn()} onEdit={onEdit} /></QueryClientProvider>);
 return { onEdit };
}
it('uses the same image viewer with a filmstrip, selects a member and edits or sets that member as cover', async () => {
 const { onEdit } = setup();
 expect(screen.getByTestId('eagle-image-viewer')).toBeInTheDocument();
 const first = screen.getByRole('button', { name: '查看第 1 张照片' });
 const secondButton = screen.getByRole('button', { name: '查看第 2 张照片' });
 expect(first).toHaveAttribute('aria-pressed', 'true');
 fireEvent.click(secondButton);
 await screen.findByRole('dialog', { name: 'Second' });
 expect(secondButton).toHaveAttribute('aria-pressed', 'true');
 fireEvent.click(screen.getByRole('button', { name: '编辑照片' }));
 expect(onEdit).toHaveBeenCalledWith(second);
 fireEvent.click(screen.getByRole('button', { name: '设为主图' }));
 await waitFor(() => expect(changeGroup).toHaveBeenCalledWith('stack', { bestAssetId: 'b' }));
});
it('exposes member loading errors without editing the cover as a substitute', async () => {
 fetchAsset.mockRejectedValue(new Error('member unavailable'));
 const { onEdit } = setup();
 fireEvent.click(screen.getByRole('button', { name: '查看第 2 张照片' }));
 await waitFor(() => expect(screen.getAllByRole('alert').some(el => el.textContent?.includes('member unavailable'))).toBe(true));
 expect(screen.queryByRole('button', { name: '编辑照片' })).not.toBeInTheDocument();
 expect(onEdit).not.toHaveBeenCalled();
 expect(screen.getByRole('button', { name: '设为主图' })).toBeDisabled();
});
