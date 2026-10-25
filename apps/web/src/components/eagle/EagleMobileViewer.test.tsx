import { expect, it, vi } from 'vitest';
import { toggleViewerFavorite } from './EagleMobileViewer';
import type { EagleAssetListItem } from '../../lib/eagle-api';
it('does not turn a photo private through the favorite shortcut', async () => {
  const api = {
    listEagleManualTags: vi.fn().mockResolvedValue([{ id: 'favorite', name: '收藏' }]),
    createEagleManualTag: vi.fn(),
    getEaglePrivacySettings: vi.fn().mockResolvedValue({ tagIds: ['favorite'] }),
    batchChangeEagleManualTags: vi.fn(),
  };
  await expect(
    toggleViewerFavorite(api, { id: 'photo' } as EagleAssetListItem, false),
  ).rejects.toThrow('私密');
  expect(api.batchChangeEagleManualTags).not.toHaveBeenCalled();
});
it('adds and removes only the favorite tag through the scoped shared API', async () => {
  const api = {
    listEagleManualTags: vi.fn().mockResolvedValue([{ id: 'favorite', name: '收藏' }]),
    createEagleManualTag: vi.fn(),
    getEaglePrivacySettings: vi.fn().mockResolvedValue({ tagIds: [] }),
    batchChangeEagleManualTags: vi.fn().mockResolvedValue({}),
  };
  await toggleViewerFavorite(api, { id: 'photo' } as EagleAssetListItem, false);
  expect(api.batchChangeEagleManualTags).toHaveBeenLastCalledWith('', {
    assetIds: ['photo'],
    addTagIds: ['favorite'],
    removeTagIds: [],
  });
  await toggleViewerFavorite(api, { id: 'photo' } as EagleAssetListItem, true);
  expect(api.batchChangeEagleManualTags).toHaveBeenLastCalledWith('', {
    assetIds: ['photo'],
    addTagIds: [],
    removeTagIds: ['favorite'],
  });
});

// Exercise the visible controls with the same scoped provider contract as the workspace.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EagleViewerShell } from './EagleViewerShell';
import { mobileViewerPresentation } from './EagleMobileViewer';
const mocks = vi.hoisted(() => ({
  api: {
    getEagleAssetContentUrl: vi.fn(() => '/api/photos/assets/one/original'),
    batchTrashEagleAssets: vi.fn(),
    listEagleManualTags: vi.fn(),
    createEagleManualTag: vi.fn(),
    getEaglePrivacySettings: vi.fn(),
    batchChangeEagleManualTags: vi.fn(),
  },
  enqueue: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ api: mocks.api, ownerId: 'owner', libraryMode: 'PHOTO' }),
}));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: () => ({ enqueue: mocks.enqueue }),
}));
vi.mock('../../lib/original-file-export', () => ({ saveOriginalFile: mocks.save }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue({ id: 'queued' });
  mocks.save.mockResolvedValue({ saved: true });
});
afterEach(() => vi.unstubAllGlobals());
const photo = {
  id: 'one',
  originalName: 'photo.png',
  displayName: 'Photo',
  mimeType: 'image/png',
  format: 'png',
  byteSize: 4,
  width: 20,
  height: 20,
  manualTags: [],
  libraryAddedAt: '2026-10-19T07:05:00Z',
} as unknown as EagleAssetListItem;
function show(asset = photo, readOnly = false) {
  const close = vi.fn(),
    edit = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EagleViewerShell
        title="Photo"
        onClose={close}
        mobile={mobileViewerPresentation(asset, close, edit, null, undefined, readOnly)}
      >
        <div />
      </EagleViewerShell>
    </QueryClientProvider>,
  );
  return { close, edit };
}
it('keeps read-only copies safe and confirms recoverable deletion', async () => {
  const { close, edit } = show();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(edit).toHaveBeenCalledOnce();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  expect(mocks.enqueue).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: '删除' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.enqueue).toHaveBeenCalledWith({
    kind: 'TRASH',
    assetIds: ['one'],
    operationId: expect.any(String),
  });
  confirm.mockRestore();
});
it('disables mutations for trash previews', () => {
  show(photo, true);
  expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '收藏' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
});
it('offers an authenticated original download when system sharing is unavailable', async () => {
  vi.stubGlobal('navigator', {});
  show();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('status')).toHaveTextContent('系统分享');
  fireEvent.click(screen.getAllByRole('button', { name: '下载原文件' }).at(-1)!);
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'one', libraryMode: 'PHOTO' }),
    ),
  );
});
it('shares the authenticated file, never an unusable private URL', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share, canShare: () => true });
  const fetch = vi.fn().mockResolvedValue(new Response('data'));
  vi.stubGlobal('fetch', fetch);
  show();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledWith('/api/photos/assets/one/original', {
    credentials: 'same-origin',
  });
  expect(share.mock.calls[0][0].files[0].name).toBe('photo.png');
});
it('avoids loading a large video into phone memory for sharing', async () => {
  const share = vi.fn(),
    fetch = vi.fn();
  vi.stubGlobal('navigator', { share, canShare: () => true });
  vi.stubGlobal('fetch', fetch);
  show({ ...photo, byteSize: 64 * 1024 * 1024 });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('status')).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
});
it('stops a changed original whose actual stream exceeds the declared sharing budget', async () => {
  const share = vi.fn();
  vi.stubGlobal('navigator', { share, canShare: () => true });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(33 * 1024 * 1024));
            controller.close();
          },
        }),
      ),
    ),
  );
  show();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('status')).toBeVisible();
  expect(share).not.toHaveBeenCalled();
});
it('creates the scoped favorite tag and updates the visible favorite state', async () => {
  mocks.api.listEagleManualTags.mockResolvedValue([]);
  mocks.api.createEagleManualTag.mockResolvedValue({ id: 'new-favorite', name: '收藏' });
  mocks.api.getEaglePrivacySettings.mockResolvedValue({ tagIds: [] });
  mocks.api.batchChangeEagleManualTags.mockResolvedValue({});
  show();
  fireEvent.click(screen.getByRole('button', { name: '收藏' }));
  expect(await screen.findByRole('button', { name: '已收藏' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(mocks.api.createEagleManualTag).toHaveBeenCalledWith('', { name: '收藏' });
});
it('reports original read failures without sharing an inaccessible file', async () => {
  const share = vi.fn();
  vi.stubGlobal('navigator', { share });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  show();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取原文件');
  expect(share).not.toHaveBeenCalled();
});
it('offers download when the system rejects the file type, and lets the user dismiss it', async () => {
  const share = vi.fn();
  vi.stubGlobal('navigator', { share, canShare: () => false });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data')));
  show();
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('status')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
});
it.each(['AbortError', 'NotAllowedError'])(
  'handles system share cancellation or failure: %s',
  async (name) => {
    vi.stubGlobal('navigator', {
      share: vi.fn().mockRejectedValue(new DOMException('share rejected', name)),
      canShare: () => true,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data')));
    show();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled());
    if (name === 'AbortError') expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    else expect(screen.getByRole('alert')).toHaveTextContent('操作失败');
  },
);
it('uses a safe title when capture and import dates are invalid', () => {
  const presentation = mobileViewerPresentation(
    { ...photo, libraryAddedAt: 'invalid' },
    vi.fn(),
    undefined,
    null,
  );
  expect(presentation.date).toBe('Photo');
  expect(presentation.time).toBeUndefined();
});
