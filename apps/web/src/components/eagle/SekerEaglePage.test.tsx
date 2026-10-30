import type * as PrivacyApiModule from '../../lib/eagle-privacy-api';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as WorkspaceModule from '../../lib/library-workspace';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SekerEaglePage } from './SekerEaglePage';

const { openSeadragonMock } = vi.hoisted(() => ({
  openSeadragonMock: vi.fn(() => ({
    addHandler: vi.fn(),
    destroy: vi.fn(),
    open: vi.fn(),
  })),
}));

const editorPropsMock = vi.hoisted(() => ({
  current: null as null | {
    source: string;
    name: string;
    initialMetadata?: { camera?: string };
    onClose: () => void;
    onSave: (file: File) => Promise<unknown>;
  },
}));
vi.mock('../media/photo-editor/PhotoEditor', () => ({
  PhotoEditor: (props: NonNullable<typeof editorPropsMock.current>) => {
    editorPropsMock.current = props;
    return (
      <div role="dialog" aria-label="编辑照片">
        <span>{props.name}</span>
        <button onClick={props.onClose}>关闭编辑器</button>
      </div>
    );
  },
}));

vi.mock('../../lib/eagle-privacy-api', async (original) => ({
  ...(await original<typeof PrivacyApiModule>()),
  getEaglePrivacySettings: async () => ({ tagIds: [] }),
}));
vi.mock('openseadragon', () => ({ default: openSeadragonMock }));
const testWorkspaceMode = vi.hoisted(() => ({ value: 'MATERIAL' as 'MATERIAL' | 'PHOTO' }));
vi.mock('../../lib/library-workspace', async (original) => {
  const actual = await original<typeof WorkspaceModule>();
  return {
    ...actual,
    useLibraryWorkspace: () => ({
      ...actual.useLibraryWorkspace(),
      libraryMode: testWorkspaceMode.value,
    }),
  };
});
vi.mock('../photos/PhotoMap', () => ({
  PhotoMap: ({
    onOpen,
  }: {
    onOpen: (item: typeof asset, context?: Array<typeof asset>) => void;
  }) => {
    const first = { ...asset, id: 'map-photo-a', displayName: 'Map Photo A' };
    const second = { ...asset, id: 'map-photo-b', displayName: 'Map Photo B' };
    const video = { ...asset, id: 'map-video', displayName: 'Map Video', mimeType: 'video/mp4' };
    return (
      <>
        <button onClick={() => onOpen(first, [first, second])}>测试地图组照片</button>
        <button onClick={() => onOpen(video, [video])}>测试地图组视频</button>
      </>
    );
  },
}));

vi.mock('../media/loading/thumbnailLoadService', () => ({
  ThumbnailLoadError: class ThumbnailLoadError extends Error {},
  ThumbnailLoadService: class ThumbnailLoadService {
    acquireCached() {
      return null;
    }
    async load(_key: string, url: string) {
      return { url, release: () => undefined };
    }
    dispose() {}
  },
}));

const enqueueAssetOperationMock = vi.fn();
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: () => ({
    enqueue: (...args: unknown[]) => enqueueAssetOperationMock(...args),
    list: async () => [],
  }),
}));
const listEagleAssetsMock = vi.fn();
const getEagleAssetMock = vi.fn();
const getEagleAssetLocationMock = vi.fn();
const sendEagleAssetsMock = vi.fn();
const getEagleTrashAssetMock = vi.fn();
const listEagleManualTagsMock = vi.fn();
const createEagleManualTagMock = vi.fn();
const listEagleManualTagGroupsMock = vi.fn();
const listEagleAiTagsMock = vi.fn();
const replaceEagleAssetManualTagsMock = vi.fn();
const batchChangeEagleManualTagsMock = vi.fn();
const listEagleTrashMock = vi.fn();
const batchTrashEagleAssetsMock = vi.fn();
const batchRestoreEagleAssetsMock = vi.fn();
const emptyEagleTrashMock = vi.fn();
const updateEagleAssetMock = vi.fn();
const batchUpdateEagleAssetsMock = vi.fn();
const uploadEagleAssetMock = vi.fn();
const listEagleSmartFoldersMock = vi.fn();
const createEagleSmartFolderMock = vi.fn();
const updateEagleSmartFolderMock = vi.fn();
const moveEagleSmartFolderMock = vi.fn();
const listEagleAssetUpdatesMock = vi.fn();
const getEaglePyramidDescriptorMock = vi.fn();
const countEagleAssetsMock = vi.fn();
const fetchEagleVectorSummaryMock = vi.fn();
const canCopyImageToClipboardMock = vi.fn();
const copyImageToClipboardMock = vi.fn();
const saveOriginalFileMock = vi.fn();
const downloadOriginalFilesMock = vi.fn();
let intersectionCallback: IntersectionObserverCallback | null = null;

vi.mock('../../lib/eagle-api', () => ({
  getEagleEditRecipe: async () => null,
  saveEagleEditRecipe: async () => ({ saved: true }),
  getEagleAssetContentUrl: (assetId: string) => `/api/eagle/assets/${assetId}/content`,
  getEagleRenditionContentUrl: (assetId: string, renditionId: string) =>
    `/api/eagle/assets/${assetId}/renditions/${renditionId}/content`,
  getEaglePyramidDescriptor: (...args: unknown[]) => getEaglePyramidDescriptorMock(...args),
  countEagleAssets: (...args: unknown[]) => countEagleAssetsMock(...args),
  listEagleAssets: (...args: unknown[]) => listEagleAssetsMock(...args),
  getEagleAsset: (...args: unknown[]) => getEagleAssetMock(...args),
  getEagleAssetLocation: (...args: unknown[]) => getEagleAssetLocationMock(...args),
  sendEagleAssets: (...args: unknown[]) => sendEagleAssetsMock(...args),
  getEagleTrashAsset: (...args: unknown[]) => getEagleTrashAssetMock(...args),
  listEagleAssetUpdates: (...args: unknown[]) => listEagleAssetUpdatesMock(...args),
  listEagleManualTags: (...args: unknown[]) => listEagleManualTagsMock(...args),
  listEagleManualTagGroups: (...args: unknown[]) => listEagleManualTagGroupsMock(...args),
  listEagleAiTags: (...args: unknown[]) => listEagleAiTagsMock(...args),
  createEagleManualTag: (...args: unknown[]) => createEagleManualTagMock(...args),
  createEagleManualTagGroup: vi.fn(),
  updateEagleManualTag: vi.fn(),
  deleteEagleManualTag: vi.fn(),
  updateEagleManualTagGroup: vi.fn(),
  deleteEagleManualTagGroup: vi.fn(),
  replaceEagleAssetManualTags: (...args: unknown[]) => replaceEagleAssetManualTagsMock(...args),
  batchChangeEagleManualTags: (...args: unknown[]) => batchChangeEagleManualTagsMock(...args),
  listEagleTrash: (...args: unknown[]) => listEagleTrashMock(...args),
  batchTrashEagleAssets: (...args: unknown[]) => batchTrashEagleAssetsMock(...args),
  batchRestoreEagleAssets: (...args: unknown[]) => batchRestoreEagleAssetsMock(...args),
  emptyEagleTrash: (...args: unknown[]) => emptyEagleTrashMock(...args),
  updateEagleAsset: (...args: unknown[]) => updateEagleAssetMock(...args),
  batchUpdateEagleAssets: (...args: unknown[]) => batchUpdateEagleAssetsMock(...args),
  uploadEagleAsset: (...args: unknown[]) => uploadEagleAssetMock(...args),
  listEagleSmartFolders: (...args: unknown[]) => listEagleSmartFoldersMock(...args),
  createEagleSmartFolder: (...args: unknown[]) => createEagleSmartFolderMock(...args),
  updateEagleSmartFolder: (...args: unknown[]) => updateEagleSmartFolderMock(...args),
  moveEagleSmartFolder: (...args: unknown[]) => moveEagleSmartFolderMock(...args),
}));

vi.mock('./EagleTaskCenter', () => ({
  EagleTaskCenter: () => (
    <section aria-label="任务中心" data-testid="eagle-processing-page">
      后台工作
    </section>
  ),
}));

vi.mock('../../lib/eagle-vector-api', () => ({
  fetchEagleVectorSummary: (...args: unknown[]) => fetchEagleVectorSummaryMock(...args),
}));

vi.mock('../../lib/image-clipboard', () => ({
  canCopyImageToClipboard: () => canCopyImageToClipboardMock(),
  copyImageToClipboard: (...args: unknown[]) => copyImageToClipboardMock(...args),
}));

vi.mock('../../lib/original-file-export', () => ({
  saveOriginalFile: (...args: unknown[]) => saveOriginalFileMock(...args),
  downloadOriginalFiles: (...args: unknown[]) => downloadOriginalFilesMock(...args),
}));

vi.mock('./EagleVectorWorkspace', () => ({
  EagleVectorWorkspace: ({
    view,
    onTrashAssets,
  }: {
    view: string;
    onTrashAssets?: (assetIds: string[]) => Promise<void>;
  }) => (
    <div data-testid="eagle-vector-workspace" data-view={view}>
      智能标签工作区
      <button type="button" onClick={() => void onTrashAssets?.(['asset-1'])}>
        测试智能标签删除
      </button>
    </div>
  ),
}));

const asset = {
  id: 'asset-1',
  originalName: 'owl-reference.png',
  displayName: 'Owl Reference',
  mimeType: 'image/png',
  format: 'png',
  byteSize: 2048,
  width: 1200,
  height: 800,
  durationMs: null,
  lifecycleStatus: 'READY',
  mediaErrorCode: null,
  mediaRevision: 1,
  rowVersion: 1,
  rating: null,
  annotation: null,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
  renditions: [
    {
      id: 'rendition-1',
      kind: 'THUMBNAIL',
      revision: 1,
      mimeType: 'image/jpeg',
      byteSize: 512,
      width: 800,
      height: 533,
    },
  ],
  manualTags: [],
  aiTags: [],
};

function renderPage(
  ownerId = 'owner-test',
  canManageProcessing = false,
  privacyVisibility?: { enabled: boolean; durationHours: number; expiresAt: string | null },
  modeSwitcher?: ReactNode,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (currentOwnerId: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LibraryWorkspaceProvider ownerId={currentOwnerId} libraryMode="MATERIAL">
          <SekerEaglePage
            accessToken="token"
            modeSwitcher={modeSwitcher}
            ownerId={currentOwnerId}
            canManageProcessing={canManageProcessing}
            privacyVisibility={privacyVisibility}
          />
        </LibraryWorkspaceProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(page(ownerId)), client, renderForOwner: page };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function selectAssetAndOpenInspector() {
  fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
  fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));
  const inspector = await screen.findByRole('complementary', { name: '素材详情' });
  await within(inspector).findByRole('textbox', { name: '素材标题' });
  return inspector;
}

describe('SekerEaglePage', () => {
  it('loads the first page before secondary catalogs and statistics', async () => {
    const first = createDeferred<{ items: (typeof asset)[]; nextCursor: null }>();
    listEagleAssetsMock.mockReturnValue(first.promise);
    renderPage();
    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalled());
    expect(listEagleManualTagsMock).not.toHaveBeenCalled();
    expect(listEagleManualTagGroupsMock).not.toHaveBeenCalled();
    expect(listEagleSmartFoldersMock).not.toHaveBeenCalled();
    first.resolve({ items: [asset], nextCursor: null });
    await waitFor(() => expect(listEagleManualTagsMock).toHaveBeenCalled());
  });

  it('shows the library total in navigation without repeating it in the heading', async () => {
    countEagleAssetsMock.mockResolvedValue({ count: 72100 });
    renderPage();
    expect(await screen.findByRole('button', { name: '全部 72100' })).toBeInTheDocument();
    expect(screen.queryByText('72100 项')).not.toBeInTheDocument();
    expect(listEagleAssetsMock).toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    testWorkspaceMode.value = 'MATERIAL';
    delete (globalThis as { sekerDesktop?: unknown }).sekerDesktop;
    window.localStorage.clear();
    intersectionCallback = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      },
    );
    listEagleAssetsMock.mockResolvedValue({ items: [asset], nextCursor: null });
    getEaglePyramidDescriptorMock.mockRejectedValue(new Error('图像金字塔不存在'));
    countEagleAssetsMock.mockResolvedValue({ count: 1 });
    getEagleAssetMock.mockResolvedValue(asset);
    getEagleTrashAssetMock.mockResolvedValue({
      ...asset,
      deletedAt: '2026-08-14T01:00:00.000Z',
    });
    listEagleManualTagsMock.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: '灵感',
        color: null,
        groupId: null,
        isStarred: false,
        rowVersion: 1,
        assetCount: 1,
        pinyin: 'linggan',
        pinyinInitials: 'lg',
      },
    ]);
    listEagleManualTagGroupsMock.mockResolvedValue([]);
    listEagleAiTagsMock.mockResolvedValue([
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: '猫头鹰',
        assetCount: 1,
        pinyin: 'maotouying',
        pinyinInitials: 'mty',
      },
    ]);
    replaceEagleAssetManualTagsMock.mockResolvedValue({
      affectedAssetCount: 1,
      privacyChangedAssetCount: 0,
    });
    createEagleManualTagMock.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      name: '新标签',
      color: null,
      groupId: null,
      isStarred: false,
      rowVersion: 1,
      assetCount: 0,
      pinyin: 'xinbiaoqian',
      pinyinInitials: 'xbq',
    });
    batchChangeEagleManualTagsMock.mockResolvedValue({
      affectedAssetCount: 1,
      privacyChangedAssetCount: 0,
    });
    listEagleTrashMock.mockResolvedValue({
      items: [{ ...asset, deletedAt: '2026-08-14T01:00:00.000Z' }],
      nextCursor: null,
    });
    enqueueAssetOperationMock.mockResolvedValue({
      id: 'queued',
      kind: 'TRASH',
      libraryMode: 'MATERIAL',
      total: 1,
      queued: 1,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      state: 'QUEUED',
      errors: [],
    });
    batchTrashEagleAssetsMock.mockResolvedValue({ affectedAssetCount: 1 });
    batchRestoreEagleAssetsMock.mockResolvedValue({ affectedAssetCount: 1 });
    emptyEagleTrashMock.mockResolvedValue({ affectedAssetCount: 1 });
    updateEagleAssetMock.mockResolvedValue({ ...asset, rating: 4, rowVersion: 2 });
    batchUpdateEagleAssetsMock.mockResolvedValue({
      affectedAssetCount: 2,
      assets: [
        { assetId: 'asset-1', rowVersion: 2 },
        { assetId: 'asset-2', rowVersion: 5 },
      ],
    });
    canCopyImageToClipboardMock.mockReturnValue(true);
    copyImageToClipboardMock.mockResolvedValue(undefined);
    saveOriginalFileMock.mockImplementation((target: { id: string }) => {
      const bridge = (
        globalThis as {
          sekerDesktop?: { saveOriginalFile?: (assetId: string) => Promise<{ saved: boolean }> };
        }
      ).sekerDesktop?.saveOriginalFile;
      return bridge ? bridge(target.id) : Promise.resolve({ saved: true });
    });
    downloadOriginalFilesMock.mockImplementation((targets: Array<{ id: string }>) => {
      const bridge = (
        globalThis as {
          sekerDesktop?: {
            downloadOriginalFiles?: (assetIds: string[]) => Promise<{ downloaded: number }>;
          };
        }
      ).sekerDesktop?.downloadOriginalFiles;
      return bridge
        ? bridge(targets.map(({ id }) => id))
        : Promise.resolve({ downloaded: targets.length });
    });
    listEagleSmartFoldersMock.mockResolvedValue([]);
    createEagleSmartFolderMock.mockResolvedValue({
      id: 'folder-1',
      name: '猫头鹰精选',
      color: null,
      parentId: null,
      queryVersion: 1,
      queryJson: { version: 1, filters: {} },
      position: 0,
      rowVersion: 1,
    });
    updateEagleSmartFolderMock.mockResolvedValue({
      id: 'folder-1',
      name: '猫头鹰精选',
      color: '#65ad78',
      parentId: null,
      queryVersion: 1,
      queryJson: { version: 1, filters: {} },
      position: 0,
      rowVersion: 2,
    });
    moveEagleSmartFolderMock.mockResolvedValue({
      id: 'folder-2',
      name: '海报',
      color: null,
      parentId: 'folder-1',
      queryVersion: 1,
      queryJson: { version: 1, filters: {} },
      position: 0,
      rowVersion: 2,
    });
    listEagleAssetUpdatesMock.mockResolvedValue([]);
    uploadEagleAssetMock.mockResolvedValue({ duplicate: false });
    fetchEagleVectorSummaryMock.mockResolvedValue({
      tags: { enabled: 15, ready: 12, awaitingCenter: 3 },
      suggestions: { unclassified: 38, pending: 32 },
    });
  });

  it('places the single mode switch in the sidebar brand position without a separate header', () => {
    renderPage(
      'owner-test',
      false,
      undefined,
      <nav aria-label="图库模式">
        <button aria-pressed="true">素材</button>
        <button aria-pressed="false">照片</button>
      </nav>,
    );
    const sidebar = screen.getByRole('navigation', { name: '素材库导航' });
    const switcher = within(sidebar).getByRole('navigation', { name: '图库模式' });
    expect(screen.getAllByRole('navigation', { name: '图库模式' })).toHaveLength(1);
    expect(within(switcher).getByRole('button', { name: '素材' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sidebar).queryByText('SekerEagle')).not.toBeInTheDocument();
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
  });

  it.each(['MATERIAL', 'PHOTO'] as const)(
    'renders retained %s pages immediately even when the next request cannot finish',
    async (mode) => {
      testWorkspaceMode.value = mode;
      const view = renderPage('returning-owner');
      await screen.findByRole('button', { name: /Owl Reference/ });
      view.rerender(<></>);
      listEagleAssetsMock.mockImplementation(() => new Promise(() => undefined));
      view.rerender(view.renderForOwner('returning-owner'));
      expect(screen.getByRole('button', { name: /Owl Reference/ })).toBeInTheDocument();
      expect(listEagleAssetsMock).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps old cards visible but unavailable while an uncached search is pending', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Owl Reference/ });
    const next = createDeferred<{ items: (typeof asset)[]; nextCursor: null }>();
    listEagleAssetsMock.mockReturnValue(next.promise);
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材' }), {
      target: { value: '北京' },
    });
    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.at(-1)?.[1]).toMatchObject({ search: '北京' }),
    );
    expect(screen.getByRole('button', { name: /Owl Reference/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '素材瀑布流' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('status', { name: '正在加载素材…' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Owl Reference/ }));
    expect(screen.queryByRole('complementary', { name: '素材详情' })).not.toBeInTheDocument();
    next.resolve({ items: [], nextCursor: null });
    await screen.findByText('没有匹配的素材');
    expect(screen.queryByRole('button', { name: /Owl Reference/ })).not.toBeInTheDocument();
  });

  it('retains search and filters across tag navigation and workspace remounts', async () => {
    const view = renderPage('browse-owner');
    await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材' }), {
      target: { value: '北京' },
    });
    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.at(-1)?.[1]).toMatchObject({ search: '北京' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '素材库导航' })).getByRole('button', {
        name: /^全部/,
      }),
    );
    expect(screen.getByRole('searchbox', { name: '搜索素材' })).toHaveValue('北京');
    view.rerender(<></>);
    view.rerender(view.renderForOwner('browse-owner'));
    expect(screen.getByRole('searchbox', { name: '搜索素材' })).toHaveValue('北京');
  });

  it('keeps browse memories separate between modes and clears them on session reset', async () => {
    const view = renderPage('mode-memory');
    await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材' }), {
      target: { value: '北京' },
    });
    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.at(-1)?.[1]).toMatchObject({ search: '北京' }),
    );
    view.rerender(<></>);
    testWorkspaceMode.value = 'PHOTO';
    view.rerender(view.renderForOwner('mode-memory'));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    await screen.findByRole('button', { name: /Owl Reference/ });
    view.rerender(<></>);
    testWorkspaceMode.value = 'MATERIAL';
    view.rerender(view.renderForOwner('mode-memory'));
    expect(screen.getByRole('searchbox', { name: '搜索素材' })).toHaveValue('北京');
    view.rerender(<></>);
    view.client.clear();
    view.rerender(view.renderForOwner('mode-memory'));
    expect(screen.getByRole('searchbox', { name: '搜索素材' })).toHaveValue('');
  });

  it('does not retain active cards as placeholders in an unlocked private scope', async () => {
    renderPage('private-placeholder', false, {
      enabled: true,
      durationHours: 1,
      expiresAt: '2099-01-01T00:00:00Z',
    });
    await screen.findByRole('button', { name: /Owl Reference/ });
    listEagleAssetsMock.mockImplementation(() => new Promise(() => undefined));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材' }), {
      target: { value: '北京' },
    });
    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.at(-1)?.[1]).toMatchObject({ search: '北京' }),
    );
    expect(screen.queryByRole('button', { name: /Owl Reference/ })).not.toBeInTheDocument();
  });

  it('shows cached cards while refreshing an invalidated list in the background', async () => {
    const view = renderPage('refresh-owner');
    await screen.findByRole('button', { name: /Owl Reference/ });
    view.rerender(<></>);
    const refresh = createDeferred<{ items: (typeof asset)[]; nextCursor: null }>();
    listEagleAssetsMock.mockReturnValue(refresh.promise);
    await view.client.invalidateQueries({
      queryKey: ['eagle', 'refresh-owner', 'MATERIAL', 'assets'],
    });
    view.rerender(view.renderForOwner('refresh-owner'));
    expect(screen.getByRole('button', { name: /Owl Reference/ })).toBeInTheDocument();
    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalledTimes(2));
    await act(async () =>
      refresh.resolve({ items: [{ ...asset, displayName: 'Updated Owl' }], nextCursor: null }),
    );
    expect(await screen.findByRole('button', { name: /Updated Owl/ })).toBeInTheDocument();
  });

  it('uses a fresh cache namespace when the owner changes', async () => {
    const view = renderPage('owner-a');
    await screen.findByRole('button', { name: /Owl Reference/ });
    expect(
      view.client.getQueryCache().findAll({ queryKey: ['eagle', 'owner-a'] }),
    ).not.toHaveLength(0);

    view.rerender(view.renderForOwner('owner-b'));
    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalledTimes(2));
    expect(
      view.client.getQueryCache().findAll({ queryKey: ['eagle', 'owner-b'] }),
    ).not.toHaveLength(0);
  });

  it('releases the context menu after accepting a send without hiding an unpublished source', async () => {
    renderPage();
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '发送到照片' }));
    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'SEND',
        assetIds: [asset.id],
        operationId: expect.any(String),
      }),
    );
    expect(await screen.findByText('已加入任务中心，可继续浏览。')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '发送到照片' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Owl Reference/ })).toBeInTheDocument();
    expect(sendEagleAssetsMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '查看进度' }));
    expect(await screen.findByTestId('eagle-processing-page')).toBeInTheDocument();
  });

  it('loads newer neighbors after locating into the middle without discarding the current page', async () => {
    const newer = { ...asset, id: 'newer-asset', displayName: 'Newer neighbor' };
    getEagleAssetLocationMock.mockResolvedValue({ assetId: asset.id, cursor: 'middle' });
    listEagleAssetsMock.mockImplementation((_token, filters) =>
      Promise.resolve(
        filters.cursor === 'newer'
          ? { items: [newer], nextCursor: 'back', previousCursor: null }
          : {
              items: [asset],
              nextCursor: null,
              previousCursor: filters.cursor === 'middle' ? 'newer' : null,
            },
      ),
    );
    renderPage();
    Object.defineProperty(screen.getByRole('region', { name: '素材瀑布流' }), 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.doubleClick(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(await screen.findByRole('button', { name: '定位到时间线' }));
    await waitFor(() =>
      expect(listEagleAssetsMock).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({ cursor: 'newer' }),
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('button', { name: /Newer neighbor/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Owl Reference/ })).toBeInTheDocument();
  });

  it('returns from a search preview to the unfiltered dated neighborhood', async () => {
    getEagleAssetLocationMock.mockResolvedValue({ assetId: asset.id, cursor: 'nearby-cursor' });
    renderPage();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'owl' } });
    await waitFor(() =>
      expect(listEagleAssetsMock).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({ search: 'owl' }),
        expect.anything(),
      ),
    );
    fireEvent.doubleClick(await screen.findByRole('button', { name: /Owl Reference/ }));
    const locate = await screen.findByRole('button', { name: '定位到时间线' });
    expect(
      locate.compareDocumentPosition(screen.getByRole('button', { name: '复制图片' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(locate);
    await waitFor(() =>
      expect(getEagleAssetLocationMock).toHaveBeenCalledWith('', asset.id, expect.any(AbortSignal)),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('searchbox')).toHaveValue('');
    await waitFor(() =>
      expect(listEagleAssetsMock).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({
          cursor: 'nearby-cursor',
          search: undefined,
          rules: undefined,
          smartFolderId: undefined,
        }),
        expect.anything(),
      ),
    );
  });

  it('explains when image search falls back to names and manual tags', async () => {
    listEagleAssetsMock.mockResolvedValue({
      items: [asset],
      nextCursor: null,
      imageSearch: { status: 'UNAVAILABLE', spaceId: 'test' },
    });
    renderPage();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索素材' }), {
      target: { value: '窗边的猫' },
    });
    expect(
      await screen.findByText('图片内容搜索暂不可用，当前仅匹配名称和人工标签。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('标签匹配')).not.toBeInTheDocument();
  });

  it('keeps inspector visibility independent from the current asset selection', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '素材库导航' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索素材' })).toBeInTheDocument();
    const assetCard = await screen.findByRole('button', { name: /Owl Reference/ });
    expect(assetCard).not.toHaveTextContent('Owl Reference');
    expect(assetCard).not.toHaveTextContent('1200 × 800');
    expect(assetCard).not.toHaveTextContent('PNG');
    expect(assetCard).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() =>
      expect(assetCard.querySelector('img')).toHaveAttribute('draggable', 'false'),
    );
    expect(screen.queryByRole('complementary', { name: '素材详情' })).not.toBeInTheDocument();
    const inspectorToggle = screen.getByRole('button', { name: '显示素材详情' });
    expect(inspectorToggle).toBeEnabled();
    fireEvent.click(inspectorToggle);
    expect(screen.getByRole('complementary', { name: '素材详情' })).toHaveTextContent(
      '选择一项素材查看详情',
    );

    fireEvent.click(assetCard);
    expect(assetCard).toHaveAttribute('aria-pressed', 'true');
    expect(
      await within(screen.getByRole('complementary', { name: '素材详情' })).findByRole('textbox', {
        name: '素材标题',
      }),
    ).toHaveValue('Owl Reference');

    fireEvent.click(screen.getByRole('region', { name: '素材瀑布流' }));
    expect(screen.getByRole('complementary', { name: '素材详情' })).toHaveTextContent(
      '选择一项素材查看详情',
    );
    expect(screen.getByRole('button', { name: '隐藏素材详情' })).toBePressed();

    fireEvent.click(screen.getByRole('button', { name: '关闭素材详情' }));
    expect(screen.queryByRole('complementary', { name: '素材详情' })).not.toBeInTheDocument();
    fireEvent.click(assetCard);
    expect(screen.queryByRole('complementary', { name: '素材详情' })).not.toBeInTheDocument();
  });

  it('opens the account view from the settings workspace without replacing the sidebar', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SekerEaglePage
            accessToken="token"
            ownerId="owner-test"
            accountView={<div data-testid="embedded-account-view">账号信息</div>}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByRole('heading', { name: '全部' });
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '素材库导航' })).getByRole('button', {
        name: '设置',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '设置功能' })).getByRole('button', {
        name: '账号',
      }),
    );
    expect(screen.getByRole('navigation', { name: '设置功能' }).closest('header')).toHaveAttribute(
      'data-layout',
      'sidebar',
    );
    expect(screen.getByRole('navigation', { name: '素材库导航' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByTestId('embedded-account-view')).toBeInTheDocument();
  });

  it('opens asset processing from the pending workspace', async () => {
    renderPage('owner-test', true);

    fireEvent.click(await screen.findByRole('button', { name: '待处理 38' }));
    const pendingNavigation = screen.getByRole('navigation', { name: '待处理功能' });
    expect(pendingNavigation.closest('header')).toHaveAttribute('data-layout', 'tabs');
    expect(
      within(pendingNavigation)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['推荐审核32', '待分类6', '任务中心']);
    expect(await screen.findByTestId('eagle-vector-workspace')).toHaveAttribute(
      'data-view',
      'REVIEW',
    );
    fireEvent.click(
      within(pendingNavigation).getByRole('button', {
        name: '任务中心',
      }),
    );

    expect(await screen.findByTestId('eagle-processing-page')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '任务中心' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 内容识别设置' })).not.toBeInTheDocument();
  });

  it('keeps processing tasks available for ordinary owners inside the pending workspace', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '全部' });
    fireEvent.click(await screen.findByRole('button', { name: '待处理 38' }));
    expect(
      within(screen.getByRole('navigation', { name: '待处理功能' })).getByRole('button', {
        name: '任务中心',
      }),
    ).toBeInTheDocument();
  });

  it('changes and persists the thumbnail size', async () => {
    renderPage();

    const slider = await screen.findByRole('slider', { name: '缩略图大小' });
    expect(slider).toHaveAttribute('min', '140');
    expect(slider).toHaveAttribute('max', '320');
    expect(slider).toHaveValue('210');

    fireEvent.change(slider, { target: { value: '320' } });

    expect(slider).toHaveValue('320');
    expect(
      window.localStorage.getItem('seker-eagle.preferences.v1:["owner-test","MATERIAL"]'),
    ).toContain('320');
  });

  it('applies common filters from a dedicated quick-filter popover', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '展开筛选' }));
    fireEvent.click(await screen.findByRole('button', { name: '格式筛选' }));
    const formatFilter = screen.getByRole('dialog', { name: '格式筛选' });
    fireEvent.click(within(formatFilter).getByRole('checkbox', { name: 'PNG' }));

    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as {
        rules?: { conditions: Array<{ rules: Array<{ field: string; value: string }> }> };
      };
      expect(filters.rules?.conditions[0]?.rules[0]).toEqual(
        expect.objectContaining({ field: 'FORMAT', value: 'png' }),
      );
    });
  });

  it('keeps large tag collections searchable and bounded inside the tag popover', async () => {
    const manualTags = Array.from({ length: 180 }, (_, index) => ({
      id: `manual-tag-${index + 1}`,
      name: `人工标签 ${String(index + 1).padStart(2, '0')}`,
      color: null,
      groupId: null,
      isStarred: false,
      rowVersion: 1,
      assetCount: index + 1,
      pinyin: `rengongbiaoqian${index + 1}`,
      pinyinInitials: `rgbq${index + 1}`,
    }));
    listEagleManualTagsMock.mockResolvedValue(manualTags);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '展开筛选' }));
    fireEvent.click(await screen.findByRole('button', { name: '标签筛选' }));
    const filterPanel = screen.getByRole('dialog', { name: '标签筛选' });
    const manualTagSearch = within(filterPanel).getByRole('searchbox', { name: '搜索标签' });

    expect((await within(filterPanel).findAllByRole('checkbox')).length).toBeLessThanOrEqual(100);
    fireEvent.change(manualTagSearch, { target: { value: '人工标签 01' } });
    fireEvent.click(within(filterPanel).getByRole('checkbox', { name: /人工标签 01/ }));

    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as {
        rules?: { conditions: Array<{ rules: Array<{ field: string; value: string[] }> }> };
      };
      expect(filters.rules?.conditions[0]?.rules[0]).toEqual(
        expect.objectContaining({ field: 'MANUAL_TAGS', value: ['manual-tag-1'] }),
      );
    });
  });

  it('applies a canonical color as a server-side asset filter', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '展开筛选' }));
    fireEvent.click(await screen.findByRole('button', { name: '颜色筛选' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: '颜色筛选' })).getByRole('button', {
        name: '颜色 #2e86ab',
      }),
    );

    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as {
        rules?: { conditions: Array<{ rules: Array<{ field: string; value: string }> }> };
      };
      expect(filters.rules?.conditions[0]?.rules[0]).toEqual(
        expect.objectContaining({ field: 'COLOR', value: '#2e86ab' }),
      );
    });
    expect(screen.getByRole('button', { name: '颜色筛选，#2E86AB' })).toBeInTheDocument();
  });

  it('automatically saves edited metadata after leaving the field', async () => {
    renderPage();
    await selectAssetAndOpenInspector();

    fireEvent.change(screen.getByRole('textbox', { name: '素材标题' }), {
      target: { value: 'Night Owl' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '素材描述' }), {
      target: { value: '用于夜景灵感板' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '素材来源链接' }), {
      target: { value: 'https://example.com/owl' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: '素材来源链接' }));

    await waitFor(() => {
      expect(updateEagleAssetMock).toHaveBeenCalledWith('token', 'asset-1', {
        displayName: 'Night Owl',
        description: '用于夜景灵感板',
        sourceUrl: 'https://example.com/owl',
        rowVersion: 1,
      });
    });
    expect(screen.queryByRole('button', { name: '保存素材信息' })).not.toBeInTheDocument();
  });

  it('serializes overlapping metadata autosaves with the latest row version', async () => {
    let resolveFirstSave!: (value: typeof asset) => void;
    updateEagleAssetMock
      .mockImplementationOnce(
        () =>
          new Promise<typeof asset>((resolve) => {
            resolveFirstSave = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...asset,
        displayName: 'Night Owl',
        annotation: { description: '用于夜景灵感板', sourceUrl: null },
        rowVersion: 3,
      });
    renderPage();
    await selectAssetAndOpenInspector();

    const title = screen.getByRole('textbox', { name: '素材标题' });
    fireEvent.change(title, { target: { value: 'Night Owl' } });
    fireEvent.blur(title);
    await waitFor(() => expect(updateEagleAssetMock).toHaveBeenCalledTimes(1));

    const description = screen.getByRole('textbox', { name: '素材描述' });
    fireEvent.change(description, { target: { value: '用于夜景灵感板' } });
    fireEvent.blur(description);
    expect(updateEagleAssetMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirstSave({ ...asset, displayName: 'Night Owl', rowVersion: 2 });
    });

    await waitFor(() => {
      expect(updateEagleAssetMock).toHaveBeenLastCalledWith('token', 'asset-1', {
        displayName: 'Night Owl',
        description: '用于夜景灵感板',
        rowVersion: 2,
      });
    });
  });

  it('does not autosave another field while the source URL is invalid', async () => {
    renderPage();
    await selectAssetAndOpenInspector();

    fireEvent.change(screen.getByRole('textbox', { name: '素材来源链接' }), {
      target: { value: 'not a url' },
    });
    const title = screen.getByRole('textbox', { name: '素材标题' });
    fireEvent.change(title, { target: { value: 'Night Owl' } });
    fireEvent.blur(title);

    await act(async () => Promise.resolve());
    expect(updateEagleAssetMock).not.toHaveBeenCalled();
  });

  it('orders inspector tools from title through extracted-color placeholder', async () => {
    renderPage();
    const inspector = await selectAssetAndOpenInspector();

    const orderedTools = [
      within(inspector).getByRole('textbox', { name: '素材标题' }),
      within(inspector).getByRole('heading', { name: '人工标签' }),
      within(inspector).getByRole('heading', { name: 'AI 自动标签' }),
      within(inspector).getByRole('textbox', { name: '素材描述' }),
      within(inspector).getByRole('textbox', { name: '素材来源链接' }),
      within(inspector).getByLabelText('星级评分'),
      within(inspector).getByRole('heading', { name: '颜色' }),
    ];

    for (let index = 0; index < orderedTools.length - 1; index += 1) {
      expect(orderedTools[index].compareDocumentPosition(orderedTools[index + 1])).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }
  });

  it('keeps the inspector read-only until the complete asset detail has loaded', async () => {
    getEagleAssetMock.mockReturnValue(new Promise(() => {}));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));
    await screen.findByRole('complementary', { name: '素材详情' });

    expect(screen.getByText('正在加载素材详情…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存素材信息' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加人工标签 灵感' })).not.toBeInTheDocument();
  });

  it('shows a retryable error instead of editable fallback data when detail loading fails', async () => {
    getEagleAssetMock.mockRejectedValueOnce(new Error('素材详情暂时不可用'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));
    await screen.findByRole('complementary', { name: '素材详情' });

    expect(await screen.findByRole('alert')).toHaveTextContent('素材详情暂时不可用');
    expect(screen.getByRole('button', { name: '重试加载素材详情' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存素材信息' })).not.toBeInTheDocument();
  });

  it('uses the server row version for a consecutive inspector update', async () => {
    updateEagleAssetMock
      .mockResolvedValueOnce({ ...asset, displayName: 'Night Owl', rowVersion: 2 })
      .mockResolvedValueOnce({ ...asset, displayName: 'Night Owl', rating: 5, rowVersion: 3 });
    renderPage();
    await selectAssetAndOpenInspector();
    fireEvent.change(screen.getByRole('textbox', { name: '素材标题' }), {
      target: { value: 'Night Owl' },
    });
    fireEvent.blur(screen.getByRole('textbox', { name: '素材标题' }));
    await waitFor(() => expect(updateEagleAssetMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '5 星' }));

    await waitFor(() => {
      expect(updateEagleAssetMock).toHaveBeenLastCalledWith('token', 'asset-1', {
        rating: 5,
        rowVersion: 2,
      });
    });
  });

  it('never loads the original image and retries each rendition once before trying the next', async () => {
    listEagleAssetsMock.mockResolvedValue({
      items: [
        {
          ...asset,
          renditions: [
            ...asset.renditions,
            {
              ...asset.renditions[0],
              id: 'rendition-preview',
              kind: 'PREVIEW',
            },
          ],
        },
      ],
      nextCursor: null,
    });
    const { container } = renderPage();
    await screen.findByRole('button', { name: /Owl Reference/ });
    let image: HTMLImageElement | null = null;
    await waitFor(() => {
      image = container.querySelector<HTMLImageElement>(
        'img[src="/api/eagle/assets/asset-1/renditions/rendition-1/content"]',
      );
      expect(image).not.toBeNull();
    });
    vi.useFakeTimers();
    try {
      fireEvent.error(image!);
      expect(container.querySelector('img[src="/api/eagle/assets/asset-1/content"]')).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(1_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      image = container.querySelector<HTMLImageElement>(
        'img[src="/api/eagle/assets/asset-1/renditions/rendition-1/content"]',
      );
      expect(image).not.toBeNull();
      fireEvent.error(image!);

      await act(async () => {
        vi.advanceTimersByTime(2_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      image = container.querySelector<HTMLImageElement>(
        'img[src="/api/eagle/assets/asset-1/renditions/rendition-preview/content"]',
      );
      expect(image).not.toBeNull();
      fireEvent.error(image!);

      await act(async () => {
        vi.advanceTimersByTime(4_000);
        await Promise.resolve();
        await Promise.resolve();
      });
      image = container.querySelector<HTMLImageElement>(
        'img[src="/api/eagle/assets/asset-1/renditions/rendition-preview/content"]',
      );
      expect(image).not.toBeNull();
      fireEvent.error(image!);

      const retryPrompt = screen.getByText('缩略图加载失败，点击素材重试');
      expect(retryPrompt).toBeInTheDocument();
      fireEvent.click(retryPrompt);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      image = container.querySelector<HTMLImageElement>(
        'img[src="/api/eagle/assets/asset-1/renditions/rendition-1/content"]',
      );
      expect(image).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a retry action when smart folders cannot be loaded', async () => {
    listEagleSmartFoldersMock.mockRejectedValueOnce(new Error('智能文件夹暂时不可用'));
    renderPage();

    const retry = await screen.findByRole('button', { name: '加载失败，重试' });
    fireEvent.click(retry);

    await waitFor(() => expect(listEagleSmartFoldersMock).toHaveBeenCalledTimes(2));
  });

  it('updates personal star rating with the current row version', async () => {
    renderPage();
    await selectAssetAndOpenInspector();
    fireEvent.click(screen.getByRole('button', { name: '4 星' }));

    await waitFor(() => {
      expect(updateEagleAssetMock).toHaveBeenCalledWith('token', 'asset-1', {
        rating: 4,
        rowVersion: 1,
      });
    });
  });

  it('applies inspector metadata and rating changes to every selected asset', async () => {
    const secondAsset = {
      ...asset,
      id: 'asset-2',
      displayName: 'Second Asset',
      rowVersion: 4,
    };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    getEagleAssetMock.mockImplementation(async (_token: string, assetId: string) =>
      assetId === secondAsset.id ? secondAsset : asset,
    );
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));

    const inspector = await screen.findByRole('complementary', { name: '素材详情' });
    expect(within(inspector).getByText('已选择 2 项')).toBeInTheDocument();
    const description = await within(inspector).findByRole('textbox', { name: '素材描述' });
    listEagleAssetsMock.mockResolvedValue({
      items: [
        { ...asset, rowVersion: 3 },
        { ...secondAsset, rowVersion: 6 },
      ],
      nextCursor: null,
    });
    fireEvent.change(description, {
      target: { value: '共享描述' },
    });
    fireEvent.blur(description);

    await waitFor(() => {
      expect(batchUpdateEagleAssetsMock).toHaveBeenCalledWith('token', {
        assets: [
          { assetId: 'asset-1', rowVersion: 1 },
          { assetId: 'asset-2', rowVersion: 4 },
        ],
        description: '共享描述',
      });
    });
    await waitFor(() => expect(listEagleAssetsMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    fireEvent.click(within(inspector).getByRole('button', { name: '5 星' }));
    await waitFor(() => {
      expect(batchUpdateEagleAssetsMock).toHaveBeenLastCalledWith('token', {
        assets: [
          { assetId: 'asset-1', rowVersion: 3 },
          { assetId: 'asset-2', rowVersion: 6 },
        ],
        rating: 5,
      });
    });
  });

  it('adds and removes inspector tags across the complete selected asset set', async () => {
    const assignedTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '灵感',
      color: null,
    };
    const secondAsset = {
      ...asset,
      id: 'asset-2',
      displayName: 'Second Asset',
      rowVersion: 4,
      manualTags: [],
    };
    listEagleAssetsMock.mockResolvedValue({
      items: [{ ...asset, manualTags: [assignedTag] }, secondAsset],
      nextCursor: null,
    });
    getEagleAssetMock.mockResolvedValue(secondAsset);
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));
    const inspector = await screen.findByRole('complementary', { name: '素材详情' });

    fireEvent.click(
      await within(inspector).findByRole('button', {
        name: '移除人工标签 灵感，应用于 1/2 项素材',
      }),
    );
    await waitFor(() => {
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1', 'asset-2'],
        addTagIds: [],
        removeTagIds: ['11111111-1111-4111-8111-111111111111'],
      });
    });

    fireEvent.click(within(inspector).getByRole('button', { name: '添加人工标签' }));
    const picker = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(picker).getByRole('button', { name: '添加 1 个标签到 2 项素材' }));
    await waitFor(() => {
      expect(batchChangeEagleManualTagsMock).toHaveBeenLastCalledWith('token', {
        assetIds: ['asset-1', 'asset-2'],
        addTagIds: ['11111111-1111-4111-8111-111111111111'],
        removeTagIds: [],
      });
    });
  });

  it('summarizes mixed manual tags and clears all manual tags across the selection', async () => {
    const inspirationTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '灵感',
      color: null,
    };
    const unclassifiedTag = {
      id: '44444444-4444-4444-8444-444444444444',
      name: '未分类',
      color: null,
    };
    const secondAsset = {
      ...asset,
      id: 'asset-2',
      displayName: 'Second Asset',
      rowVersion: 4,
      manualTags: [unclassifiedTag],
    };
    listEagleAssetsMock.mockResolvedValue({
      items: [{ ...asset, manualTags: [inspirationTag, unclassifiedTag] }, secondAsset],
      nextCursor: null,
    });
    getEagleAssetMock.mockResolvedValue(secondAsset);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second Asset/ }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));
    const inspector = await screen.findByRole('complementary', { name: '素材详情' });

    expect(
      await within(inspector).findByRole('heading', { name: '批量编辑人工标签' }),
    ).toBeInTheDocument();
    expect(within(inspector).getByText('灵感 · 1/2')).toBeInTheDocument();
    expect(within(inspector).getByText('未分类 · 2/2')).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole('button', { name: '清空所有人工标签' }));
    expect(confirm).toHaveBeenCalledWith(
      '将清除 2 项素材上的全部人工标签，共涉及 2 个不同标签。AI 自动标签不受影响。确认继续？',
    );
    expect(batchChangeEagleManualTagsMock).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(within(inspector).getByRole('button', { name: '清空所有人工标签' }));
    await waitFor(() => {
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1', 'asset-2'],
        addTagIds: [],
        removeTagIds: [],
        clearAll: true,
      });
    });
  });

  it('keeps manual and AI tag filters separate in the server query', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '标签' }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: /人工标签 灵感/ }));
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    const filterButton = screen.getByRole('button', { name: '标签筛选，1' });
    fireEvent.click(filterButton);
    const filterPanel = screen.getByRole('dialog', { name: '标签筛选' });
    expect(within(filterPanel).getByRole('checkbox', { name: /灵感/ })).toBeChecked();
    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as {
        rules?: { conditions: Array<{ rules: Array<{ field: string; value: string[] }> }> };
      };
      expect(filters.rules?.conditions[0]?.rules[0]).toEqual(
        expect.objectContaining({
          field: 'MANUAL_TAGS',
          value: ['11111111-1111-4111-8111-111111111111'],
        }),
      );
    });
    fireEvent.click(within(filterPanel).getByRole('button', { name: '清除此项' }));
    expect(screen.getByRole('button', { name: '标签筛选' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '标签功能' })).getByRole('button', {
        name: 'AI 标签',
      }),
    );
    fireEvent.doubleClick(await screen.findByRole('button', { name: /AI标签 猫头鹰/ }));
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    const aiFilterButton = screen.getByRole('button', { name: 'AI 标签筛选，1' });
    fireEvent.click(aiFilterButton);
    const aiFilterPanel = screen.getByRole('dialog', { name: 'AI 标签筛选' });
    expect(within(aiFilterPanel).getByRole('checkbox', { name: /猫头鹰/ })).toBeChecked();
    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as {
        rules?: { conditions: Array<{ rules: Array<{ field: string; value: string[] }> }> };
      };
      expect(filters.rules?.conditions[0]?.rules[0]).toEqual(
        expect.objectContaining({
          field: 'AI_TAGS',
          value: ['22222222-2222-4222-8222-222222222222'],
        }),
      );
    });
  });

  it('shows only manual tags assigned to the selected asset in the inspector', async () => {
    renderPage();
    const inspector = await selectAssetAndOpenInspector();
    expect(
      within(inspector).queryByRole('button', { name: '添加人工标签 灵感' }),
    ).not.toBeInTheDocument();
    expect(within(inspector).queryByText('灵感')).not.toBeInTheDocument();
  });

  it('uses the searchable tag picker from the inspector to match existing tags', async () => {
    renderPage();
    const inspector = await selectAssetAndOpenInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: '添加人工标签' }));

    const picker = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.change(within(picker).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: 'lg' },
    });
    fireEvent.click(within(picker).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(picker).getByRole('button', { name: '添加 1 个标签到 1 项素材' }));

    await waitFor(() =>
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1'],
        addTagIds: ['11111111-1111-4111-8111-111111111111'],
        removeTagIds: [],
      }),
    );
  });

  it('clears selected private assets even when desktop cache invalidation fails', async () => {
    const invalidateAsset = vi.fn().mockRejectedValue(new Error('cache unavailable'));
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(
        (media: { renditionKind: string; assetId: string; renditionId: string }) =>
          `sekereagle-media://rendition/${media.renditionKind.toLowerCase()}/${media.assetId}/${media.renditionId}`,
      ),
      getCacheStatus: vi.fn(),
      setCacheLimitGiB: vi.fn(),
      clearCache: vi.fn(),
      invalidateAsset,
    };
    batchChangeEagleManualTagsMock.mockResolvedValueOnce({
      affectedAssetCount: 1,
      privacyChangedAssetCount: 1,
    });
    renderPage();
    const inspector = await selectAssetAndOpenInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: '添加人工标签' }));

    const picker = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(picker).getByRole('button', { name: '添加 1 个标签到 1 项素材' }));

    await waitFor(() => expect(invalidateAsset).toHaveBeenCalledWith('asset-1'));
    expect(screen.queryByRole('dialog', { name: '添加标签' })).not.toBeInTheDocument();
    expect(within(inspector).getByText('选择一项素材查看详情')).toBeInTheDocument();
  });

  it('moves batch actions into the asset context menu', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.click(card, { ctrlKey: true });
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument();

    fireEvent.contextMenu(card, { clientX: 180, clientY: 120 });
    const menu = screen.getByRole('menu', { name: '素材操作' });
    expect(menu).toHaveTextContent('已选择 1 项');
    expect(within(menu).queryByRole('menuitem', { name: '添加标签 灵感' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '删除人工标签' })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '添加标签' }));
    const picker = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.click(within(picker).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(picker).getByRole('button', { name: '添加 1 个标签到 1 项素材' }));

    await waitFor(() => {
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1'],
        addTagIds: ['11111111-1111-4111-8111-111111111111'],
        removeTagIds: [],
      });
    });
  });

  it('keeps the custom menu on thumbnails and delegates large-image right clicks to the browser', async () => {
    const saveOriginalFile = vi.fn().mockResolvedValue({ saved: true });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      saveOriginalFile,
    };
    renderPage();

    const expectedActions = [
      '收藏',
      '发送到照片',
      '编辑照片',
      '另存为…',
      '复制图片',
      '添加标签',
      '删除人工标签',
      '删除所选素材',
    ];
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    expect(fireEvent.contextMenu(card, { clientX: 180, clientY: 120 })).toBe(false);
    const thumbnailMenu = screen.getByRole('menu', { name: '素材操作' });
    expect(
      within(thumbnailMenu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label') ?? item.textContent?.trim()),
    ).toEqual(expectedActions);
    fireEvent.click(within(thumbnailMenu).getByRole('menuitem', { name: '另存为…' }));
    await waitFor(() => expect(saveOriginalFile).toHaveBeenCalledWith('asset-1'));

    fireEvent.doubleClick(card);
    await screen.findByRole('dialog', { name: 'Owl Reference' });
    expect(fireEvent.contextMenu(screen.getByTestId('eagle-image-viewer'))).toBe(true);
    expect(screen.queryByRole('menu', { name: '素材操作' })).not.toBeInTheDocument();
    expect(copyImageToClipboardMock).not.toHaveBeenCalled();
  });

  it('uses the same manual favorite tag from the context menu and desktop viewer', async () => {
    const favorite = { id: 'favorite-tag', name: '收藏' };
    listEagleManualTagsMock.mockResolvedValue([favorite]);
    batchChangeEagleManualTagsMock.mockImplementationOnce(async () => {
      listEagleAssetsMock.mockResolvedValue({
        items: [{ ...asset, manualTags: [favorite] }],
        nextCursor: null,
      });
      return { affectedAssetCount: 1, privacyChangedAssetCount: 0 };
    });
    renderPage();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card, { clientX: 180, clientY: 120 });
    fireEvent.click(screen.getByRole('menuitem', { name: '收藏' }));
    await waitFor(() =>
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('', {
        assetIds: ['asset-1'],
        addTagIds: ['favorite-tag'],
        removeTagIds: [],
      }),
    );
    await screen.findByRole('menuitem', { name: '已收藏' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    getEagleAssetMock.mockResolvedValue({ ...asset, manualTags: [favorite] });
    fireEvent.doubleClick(card);
    const dialog = await screen.findByRole('dialog', { name: 'Owl Reference' });
    const button = await within(dialog).findByRole('button', { name: '已收藏' });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(batchChangeEagleManualTagsMock).toHaveBeenLastCalledWith('', {
        assetIds: ['asset-1'],
        addTagIds: [],
        removeTagIds: ['favorite-tag'],
      }),
    );
    expect(dialog).toBeInTheDocument();
    expect(createEagleManualTagMock).not.toHaveBeenCalled();
  });

  it('offers Save As from the browser asset menu without a desktop bridge', async () => {
    renderPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '另存为…' }));

    await waitFor(() => expect(saveOriginalFileMock).toHaveBeenCalledWith(asset));
  });

  it('requests browser image clipboard access before the click handler returns', async () => {
    let copyStarted = false;
    copyImageToClipboardMock.mockImplementationOnce(() => {
      copyStarted = true;
      return Promise.resolve();
    });
    renderPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制图片' }));

    expect(copyStarted).toBe(true);
  });

  it('does not disguise an unavailable HTTP clipboard action as a copy preview', async () => {
    canCopyImageToClipboardMock.mockReturnValue(false);
    renderPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    const menu = screen.getByRole('menu', { name: '素材操作' });
    expect(within(menu).queryByRole('menuitem', { name: '复制图片' })).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: '打开可复制预览' }),
    ).not.toBeInTheDocument();
    expect(copyImageToClipboardMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '复制 Owl Reference' })).not.toBeInTheDocument();
  });

  it('keeps shared Save As failures visible and retryable', async () => {
    const saveOriginalFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('save denied'))
      .mockResolvedValueOnce({ saved: true });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      saveOriginalFile,
    };
    renderPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '另存为…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('另存原文件失败');
    const retry = screen.getByRole('menuitem', { name: '另存为…' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => expect(saveOriginalFile).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: '素材操作' })).not.toBeInTheDocument(),
    );
  });

  it('keeps shared image-copy failures visible and retryable', async () => {
    copyImageToClipboardMock
      .mockRejectedValueOnce(new Error('clipboard denied'))
      .mockResolvedValueOnce(undefined);
    renderPage();

    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制图片' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制图片失败');
    const retry = screen.getByRole('menuitem', { name: '复制图片' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => expect(copyImageToClipboardMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('menu', { name: '素材操作' })).not.toBeInTheDocument(),
    );
  });

  it('removes selected manual tags from the asset context menu', async () => {
    const inspirationTag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '灵感',
      color: null,
    };
    const unclassifiedTag = {
      id: '44444444-4444-4444-8444-444444444444',
      name: '未分类',
      color: null,
    };
    const secondAsset = {
      ...asset,
      id: 'asset-2',
      displayName: 'Second Asset',
      rowVersion: 4,
      manualTags: [inspirationTag],
    };
    listEagleAssetsMock.mockResolvedValue({
      items: [{ ...asset, manualTags: [inspirationTag, unclassifiedTag] }, secondAsset],
      nextCursor: null,
    });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });
    fireEvent.contextMenu(secondCard, { clientX: 180, clientY: 120 });
    fireEvent.click(
      within(screen.getByRole('menu', { name: '素材操作' })).getByRole('menuitem', {
        name: '删除人工标签',
      }),
    );

    const picker = screen.getByRole('dialog', { name: '删除人工标签' });
    expect(within(picker).getByText('灵感 · 2/2')).toBeInTheDocument();
    expect(within(picker).getByText('未分类 · 1/2')).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('checkbox', { name: '灵感' }));
    fireEvent.click(within(picker).getByRole('button', { name: '从 2 项素材删除 1 个标签' }));

    await waitFor(() =>
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1', 'asset-2'],
        addTagIds: [],
        removeTagIds: ['11111111-1111-4111-8111-111111111111'],
      }),
    );
  });

  it('shows the temporary privacy view without exposing a second per-asset privacy source', async () => {
    renderPage('owner-test', false, {
      enabled: true,
      durationHours: 3,
      expiresAt: '2026-08-19T15:00:00.000Z',
    });

    expect(await screen.findByRole('button', { name: '隐私素材' })).toBeInTheDocument();
    expect(screen.getByText('隐私内容已显示')).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card);
    expect(screen.queryByRole('menuitem', { name: '设为隐私' })).not.toBeInTheDocument();
  });

  it('creates a new manual tag from the asset context picker and applies it once', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card, { clientX: 180, clientY: 120 });
    fireEvent.click(
      within(screen.getByRole('menu', { name: '素材操作' })).getByRole('menuitem', {
        name: '添加标签',
      }),
    );

    const picker = screen.getByRole('dialog', { name: '添加标签' });
    fireEvent.change(within(picker).getByRole('searchbox', { name: '搜索可添加标签' }), {
      target: { value: '新标签' },
    });
    fireEvent.click(within(picker).getByRole('button', { name: '创建标签 新标签' }));

    await waitFor(() =>
      expect(createEagleManualTagMock).toHaveBeenCalledWith('token', { name: '新标签' }),
    );
    fireEvent.click(
      await within(picker).findByRole('button', { name: '添加 1 个标签到 1 项素材' }),
    );
    await waitFor(() =>
      expect(batchChangeEagleManualTagsMock).toHaveBeenCalledWith('token', {
        assetIds: ['asset-1'],
        addTagIds: ['33333333-3333-4333-8333-333333333333'],
        removeTagIds: [],
      }),
    );
  });

  it('deletes selected assets and restores trash assets from the context menu', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '显示素材详情' }));
    let card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.click(card, { ctrlKey: true });
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除所选素材' }));
    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'TRASH',
        assetIds: ['asset-1'],
        operationId: expect.any(String),
      }),
    );
    expect(screen.getByRole('complementary', { name: '素材详情' })).toHaveTextContent(
      '选择一项素材查看详情',
    );

    fireEvent.click(screen.getByRole('button', { name: '回收站' }));
    expect(await screen.findByRole('heading', { name: '回收站' })).toBeInTheDocument();
    card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: '恢复所选素材' }));
    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'RESTORE',
        assetIds: ['asset-1'],
        operationId: expect.any(String),
      }),
    );
  });

  it('exposes single-item restore directly in the trash toolbar', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '回收站' }));
    const restoreButton = await screen.findByRole('button', { name: '恢复当前素材' });
    expect(restoreButton).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    expect(restoreButton).toBeEnabled();
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'RESTORE',
        assetIds: ['asset-1'],
        operationId: expect.any(String),
      });
    });
  });

  it('loads recoverable trash detail through the trash endpoint and keeps it read-only', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '回收站' }));
    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: '显示素材详情' }));

    const inspector = await screen.findByRole('complementary', { name: '素材详情' });
    await waitFor(() =>
      expect(getEagleTrashAssetMock).toHaveBeenCalledWith(
        'token',
        'asset-1',
        expect.any(AbortSignal),
      ),
    );
    expect(within(inspector).getByRole('textbox', { name: '素材标题' })).toBeDisabled();
    expect(within(inspector).getByText('回收站中的素材信息为只读。')).toBeInTheDocument();
  });

  it('requires confirmation before emptying all personal trash', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '回收站' }));
    fireEvent.click(await screen.findByRole('button', { name: '清空回收站' }));

    expect(confirm).toHaveBeenCalledWith(
      '确认清空回收站？其中的全部素材将被永久删除，且无法恢复。',
    );
    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'EMPTY_TRASH',
        assetIds: [],
        operationId: expect.any(String),
      }),
    );
    confirm.mockRestore();
  });

  it('keeps trash intact when empty-trash confirmation is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '回收站' }));
    fireEvent.click(await screen.findByRole('button', { name: '清空回收站' }));

    expect(emptyEagleTrashMock).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('keeps single click as selection without opening the inspector and previews on double click', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });

    fireEvent.click(card);
    expect(screen.queryByRole('dialog', { name: 'Owl Reference' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '素材详情' })).not.toBeInTheDocument();

    fireEvent.doubleClick(card);
    expect(screen.getByRole('dialog', { name: 'Owl Reference' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '图片操作' })).toBeInTheDocument();
    expect(screen.getByTestId('eagle-image-viewer')).toBeInTheDocument();
    await waitFor(() =>
      expect(openSeadragonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tileSources: {
            type: 'image',
            url: '/api/eagle/assets/asset-1/renditions/rendition-1/content',
          },
        }),
      ),
    );
    expect(getEaglePyramidDescriptorMock).not.toHaveBeenCalled();
  });

  it('navigates between images with the left and right arrow keys while previewing', async () => {
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    const videoAsset = {
      ...asset,
      id: 'asset-video',
      displayName: 'Video Asset',
      mimeType: 'video/mp4',
      format: 'mp4',
    };
    const thirdAsset = { ...asset, id: 'asset-3', displayName: 'Third Asset' };
    listEagleAssetsMock.mockResolvedValue({
      items: [asset, secondAsset, videoAsset, thirdAsset],
      nextCursor: null,
    });
    renderPage();

    fireEvent.doubleClick(await screen.findByRole('button', { name: /Second Asset/ }));
    expect(screen.getByRole('dialog', { name: 'Second Asset' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'Owl Reference' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Second Asset' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Third Asset' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog', { name: 'Third Asset' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('preserves Ctrl and Command selection alongside explicit selection controls', async () => {
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    const thirdAsset = { ...asset, id: 'asset-3', displayName: 'Third Asset' };
    listEagleAssetsMock.mockResolvedValue({
      items: [asset, secondAsset, thirdAsset],
      nextCursor: null,
    });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    const thirdCard = screen.getByRole('button', { name: /Third Asset/ });
    expect(screen.queryByRole('toolbar', { name: '图片选择' })).not.toBeInTheDocument();
    fireEvent.click(firstCard);
    expect(screen.queryByRole('toolbar', { name: '图片选择' })).not.toBeInTheDocument();
    fireEvent.click(secondCard, { ctrlKey: true });
    expect(screen.getByRole('toolbar', { name: '图片选择' })).toBeInTheDocument();
    fireEvent.click(thirdCard, { metaKey: true });

    expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
    expect(thirdCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument();
    fireEvent.contextMenu(thirdCard);
    expect(screen.getByRole('menu', { name: '素材操作' })).toHaveTextContent('已选择 3 项');
    expect(screen.queryByRole('button', { name: '进入多选' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getByRole('button', { name: '取消选择' }));
    expect(screen.queryByRole('toolbar', { name: '图片选择' })).not.toBeInTheDocument();
  });

  it('batch-downloads selected originals from the desktop context menu in library order', async () => {
    const downloadOriginalFiles = vi.fn().mockResolvedValue({ downloaded: 2 });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      downloadOriginalFiles,
    };
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(secondCard);
    fireEvent.click(firstCard, { metaKey: true });
    fireEvent.contextMenu(firstCard);
    fireEvent.click(screen.getByRole('menuitem', { name: '批量下载（2）…' }));

    await waitFor(() => expect(downloadOriginalFiles).toHaveBeenCalledWith(['asset-1', 'asset-2']));
    expect(screen.queryByRole('menu', { name: '素材操作' })).not.toBeInTheDocument();
  });

  it('batch-downloads selected originals from the browser context menu in library order', async () => {
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(secondCard);
    fireEvent.click(firstCard, { metaKey: true });
    fireEvent.contextMenu(firstCard);
    fireEvent.click(screen.getByRole('menuitem', { name: '批量下载（2）…' }));

    await waitFor(() =>
      expect(downloadOriginalFilesMock).toHaveBeenCalledWith([asset, secondAsset]),
    );
  });

  it('shows batch download only for multiple selections with a desktop capability', async () => {
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      downloadOriginalFiles: vi.fn(),
    };
    renderPage();

    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card);

    expect(screen.queryByRole('menuitem', { name: /批量下载/u })).not.toBeInTheDocument();
  });

  it('keeps batch download failures visible and recoverable', async () => {
    const downloadOriginalFiles = vi.fn().mockRejectedValue(new Error('目标文件夹不可写。'));
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      downloadOriginalFiles,
    };
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { metaKey: true });
    fireEvent.contextMenu(secondCard);
    fireEvent.click(screen.getByRole('menuitem', { name: '批量下载（2）…' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('批量下载原文件失败。');
    expect(screen.getByRole('alert')).not.toHaveTextContent('目标文件夹不可写');
  });

  it('downloads selected originals only after an explicit drag gesture', async () => {
    const pendingDrag = createDeferred<void>();
    const prepareAssetDrag = vi.fn(() =>
      pendingDrag.promise.then(() => ({ token: '11111111-1111-4111-8111-111111111111' })),
    );
    const startPreparedAssetDrag = vi.fn();
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag,
      startPreparedAssetDrag,
    };
    const secondAsset = {
      ...asset,
      id: 'asset-2',
      originalName: 'second.png',
      displayName: 'Second Asset',
    };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    expect(firstCard).toHaveAttribute('draggable', 'true');
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });

    fireEvent.pointerEnter(secondCard);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(prepareAssetDrag).not.toHaveBeenCalled();
    expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('正在准备 2 个原文件…')).not.toBeInTheDocument();

    fireEvent.dragStart(secondCard);
    await waitFor(() => expect(prepareAssetDrag).toHaveBeenCalledWith(['asset-1', 'asset-2']));
    expect(screen.getByRole('status')).toHaveTextContent('正在准备原文件（0/2）…');
    pendingDrag.resolve();
    await waitFor(() =>
      expect(startPreparedAssetDrag).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111'),
    );
    expect(screen.queryByText(/原文件已准备好/u)).not.toBeInTheDocument();
  });

  it('never routes an outbound native file drag into the import drop zone', async () => {
    const prepareAssetDrag = vi.fn().mockResolvedValue({ token: 'drag-token' });
    const startPreparedAssetDrag = vi.fn();
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag,
      startPreparedAssetDrag,
    };
    renderPage();

    const main = screen.getByRole('main');
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.pointerEnter(card);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(prepareAssetDrag).not.toHaveBeenCalled();
    fireEvent.dragStart(card);
    await waitFor(() => expect(prepareAssetDrag).toHaveBeenCalledWith(['asset-1']));
    await waitFor(() => expect(startPreparedAssetDrag).toHaveBeenCalledWith('drag-token'));

    const outboundFile = new File(['outbound'], 'owl.png', { type: 'image/png' });
    fireEvent.dragEnter(main, { dataTransfer: { types: ['Files'] } });
    expect(screen.queryByText('松手导入素材')).not.toBeInTheDocument();
    fireEvent.drop(main, { dataTransfer: { types: ['Files'], files: [outboundFile] } });
    expect(uploadEagleAssetMock).not.toHaveBeenCalled();
  });

  it('does not launch a delayed native drag after the first gesture is released', async () => {
    const preparation = createDeferred<{ token: string }>();
    const startPreparedAssetDrag = vi.fn();
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag: vi.fn(() => preparation.promise),
      startPreparedAssetDrag,
    };
    renderPage();

    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.dragStart(card);
    fireEvent.pointerUp(window);
    expect(screen.getByRole('status')).toHaveTextContent('原文件准备已取消，可重新拖动。');
    preparation.resolve({ token: 'drag-token' });
    await Promise.resolve();
    await Promise.resolve();

    expect(startPreparedAssetDrag).not.toHaveBeenCalled();
  });

  it('replaces a previous selection when dragging an unselected desktop card', async () => {
    const prepareAssetDrag = vi
      .fn()
      .mockResolvedValue({ token: '22222222-2222-4222-8222-222222222222' });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag,
      startPreparedAssetDrag: vi.fn(),
    };
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.dragStart(secondCard);

    await waitFor(() => expect(prepareAssetDrag).toHaveBeenCalledWith(['asset-2']));
    await waitFor(() => expect(firstCard).toHaveAttribute('aria-pressed', 'false'));
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a desktop preparation error even when the bridge rejects synchronously', async () => {
    const prepareAssetDrag = vi.fn(() => {
      throw new Error('最多只能拖出 100 个原文件。');
    });
    (globalThis as { sekerDesktop?: unknown }).sekerDesktop = {
      version: 1,
      createMediaUrl: vi.fn(),
      prepareAssetDrag,
      startPreparedAssetDrag: vi.fn(),
    };
    renderPage();

    fireEvent.dragStart(await screen.findByRole('button', { name: /Owl Reference/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('最多只能拖出 100 个原文件');
  });

  it('exits batch selection with Escape', async () => {
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    listEagleAssetsMock.mockResolvedValue({ items: [asset, secondAsset], nextCursor: null });
    renderPage();

    const firstCard = await screen.findByRole('button', { name: /Owl Reference/ });
    const secondCard = screen.getByRole('button', { name: /Second Asset/ });
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });
    expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(firstCard).toHaveAttribute('aria-pressed', 'false');
    expect(secondCard).toHaveAttribute('aria-pressed', 'false');
  });

  it('clears the current selection when the masonry background is clicked', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('region', { name: '素材瀑布流' }));

    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '显示素材详情' })).toBeEnabled();
  });

  it('uses Shift-click to select a continuous range from the last plain-click anchor', async () => {
    const secondAsset = { ...asset, id: 'asset-2', displayName: 'Second Asset' };
    const thirdAsset = { ...asset, id: 'asset-3', displayName: 'Third Asset' };
    const fourthAsset = { ...asset, id: 'asset-4', displayName: 'Fourth Asset' };
    listEagleAssetsMock.mockResolvedValue({
      items: [asset, secondAsset, thirdAsset, fourthAsset],
      nextCursor: null,
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('button', { name: /Fourth Asset/ }), { shiftKey: true });

    expect(screen.getByRole('button', { name: /Owl Reference/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Second Asset/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Third Asset/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const fourthCard = screen.getByRole('button', { name: /Fourth Asset/ });
    expect(fourthCard).toHaveAttribute('aria-pressed', 'true');
    fireEvent.contextMenu(fourthCard);
    expect(screen.getByRole('menu', { name: '素材操作' })).toHaveTextContent('已选择 4 项');
  });

  it('offers file picking alongside drag-and-drop import', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: '全部' });

    expect(screen.getByRole('button', { name: '导入' })).toBeEnabled();
    expect(container.querySelector('input[type="file"]')).toBeInTheDocument();

    const file = new File(['image'], 'dropped.png', { type: 'image/png' });
    fireEvent.dragEnter(screen.getByRole('main'), {
      dataTransfer: { types: ['Files'] },
    });
    expect(screen.getByText('松手导入素材')).toBeInTheDocument();
    fireEvent.drop(screen.getByRole('main'), {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => {
      expect(uploadEagleAssetMock).toHaveBeenCalledWith('token', file, expect.any(Function));
    });
  });

  it('keeps successful duplicate imports silent after the library refreshes', async () => {
    uploadEagleAssetMock.mockResolvedValueOnce({ duplicate: true });
    renderPage();
    await screen.findByRole('heading', { name: '全部' });
    const listCallsBeforeDrop = listEagleAssetsMock.mock.calls.length;

    fireEvent.drop(screen.getByRole('main'), {
      dataTransfer: { files: [new File(['duplicate'], 'duplicate.png', { type: 'image/png' })] },
    });

    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.length).toBeGreaterThan(listCallsBeforeDrop),
    );
    expect(screen.queryByText('导入完成，跳过 1 个重复素材')).not.toBeInTheDocument();
  });

  it('removes the entire filter row when collapsed and keeps its toggle in the existing header', async () => {
    renderPage();
    const toggle = await screen.findByRole('button', { name: '展开筛选' });
    expect(screen.queryByRole('toolbar', { name: '快捷筛选' })).not.toBeInTheDocument();
    expect(toggle.parentElement).toContainElement(
      screen.getByRole('slider', { name: '缩略图大小' }),
    );
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '格式筛选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'PNG' }));
    fireEvent.click(screen.getByRole('button', { name: '收起筛选' }));
    expect(screen.queryByRole('toolbar', { name: '快捷筛选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '格式筛选' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开筛选' })).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    expect(screen.getByRole('button', { name: '格式筛选，PNG' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '格式筛选' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起筛选' }));
    fireEvent.click(screen.getByRole('button', { name: /清除全部快捷筛选/ }));
    expect(screen.getByRole('button', { name: '展开筛选' })).not.toHaveTextContent('1');
    expect(screen.queryByRole('toolbar', { name: '快捷筛选' })).not.toBeInTheDocument();
  });

  it('shows the Eagle-style quick-filter toolbar without a generic rule-builder button', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '全部' });

    expect(screen.queryByRole('toolbar', { name: '快捷筛选' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    const toolbar = screen.getByRole('toolbar', { name: '快捷筛选' });
    expect(within(toolbar).getByRole('button', { name: '颜色筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '标签筛选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '格式筛选' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '筛选' })).not.toBeInTheDocument();
    expect(screen.queryByText('规则筛选')).not.toBeInTheDocument();
  });

  it('starts inspector content directly with metadata instead of a thumbnail', async () => {
    renderPage();
    const inspector = await selectAssetAndOpenInspector();

    expect(
      within(inspector).queryByRole('button', { name: '打开大图预览' }),
    ).not.toBeInTheDocument();
    expect(within(inspector).getByRole('textbox', { name: '素材标题' })).toBeInTheDocument();
  });

  it('keeps the AI tag catalog unloaded until the user opens the AI tag tab', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '全部' });
    expect(listEagleAiTagsMock).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: '标签' }));
    expect(screen.getByRole('heading', { name: '人工标签' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '人工标签管理' })).toHaveTextContent('灵感');

    fireEvent.click(
      within(screen.getByRole('navigation', { name: '标签功能' })).getByRole('button', {
        name: 'AI 标签',
      }),
    );
    await waitFor(() => expect(listEagleAiTagsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('region', { name: 'AI 标签管理' })).toHaveTextContent('猫头鹰');
    expect(screen.queryByRole('region', { name: 'AI 自动标签运行设置' })).not.toBeInTheDocument();
  });

  it('reduces the feature navigation to tags, pending work, and settings', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '全部' });
    const sidebar = screen.getByRole('navigation', { name: '素材库导航' });

    expect(within(sidebar).getByRole('button', { name: '标签' })).toBeInTheDocument();
    expect(await within(sidebar).findByRole('button', { name: '待处理 38' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '人工标签' })).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: '智能标签确认 32' }),
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: '标签推荐设置 15' }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '待手动分类 6' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: 'AI 自动标签' })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: '素材处理' })).not.toBeInTheDocument();
  });

  it('classifies the existing features inside the three workspaces', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '待处理 38' }));
    const pendingNavigation = screen.getByRole('navigation', { name: '待处理功能' });
    expect(within(pendingNavigation).getByRole('button', { name: '待分类 6' })).toBeInTheDocument();
    fireEvent.click(within(pendingNavigation).getByRole('button', { name: '推荐审核 32' }));
    expect(await screen.findByTestId('eagle-vector-workspace')).toHaveAttribute(
      'data-view',
      'REVIEW',
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const settingsNavigation = screen.getByRole('navigation', { name: '设置功能' });
    fireEvent.click(within(settingsNavigation).getByRole('button', { name: '人工标签推荐' }));
    expect(await screen.findByTestId('eagle-vector-workspace')).toHaveAttribute(
      'data-view',
      'TAGS',
    );

    expect(
      within(settingsNavigation).queryByRole('button', { name: 'AI 内容识别' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 内容识别设置' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '标签' }));
    expect(
      within(screen.getByRole('navigation', { name: '标签功能' })).getByRole('button', {
        name: '人工标签',
      }),
    ).toBeInTheDocument();
  });

  it('connects recommendation review deletion to the shared trash mutation', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '待处理 38' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '待处理功能' })).getByRole('button', {
        name: '推荐审核 32',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '测试智能标签删除' }));

    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'TRASH',
        assetIds: ['asset-1'],
        operationId: expect.any(String),
      }),
    );
  });

  it('opens the smart-folder creator and saves its filter definition', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '新建智能文件夹' }));
    expect(screen.getByRole('dialog', { name: '新建智能文件夹' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '智能文件夹名称' }), {
      target: { value: '猫头鹰精选' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

    await waitFor(() => {
      expect(createEagleSmartFolderMock).toHaveBeenCalledWith(
        'token',
        expect.objectContaining({
          name: '猫头鹰精选',
          query: expect.objectContaining({ version: 2 }),
        }),
      );
      expect(createEagleSmartFolderMock.mock.calls[0]?.[1]).not.toHaveProperty('limit');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '新建智能文件夹' })).not.toBeInTheDocument();
    });
  });

  it('keeps saved smart-folder conditions separate from temporary filter controls', async () => {
    listEagleSmartFoldersMock.mockResolvedValueOnce([
      {
        id: 'folder-1',
        name: '双标签素材',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: {
          version: 1,
          filters: {
            manualTagIds: ['11111111-1111-4111-8111-111111111111'],
            aiTagIds: ['22222222-2222-4222-8222-222222222222'],
          },
        },
        position: 0,
        rowVersion: 1,
      },
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '双标签素材' }));
    fireEvent.click(screen.getByRole('button', { name: '展开筛选' }));
    const filterPanel = screen.getByRole('toolbar', { name: '快捷筛选' });
    expect(within(filterPanel).getByRole('button', { name: '标签筛选' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: /清除全部快捷筛选/ })).not.toBeInTheDocument();
  });

  it('wires smart-folder color and nesting actions to persistent APIs', async () => {
    listEagleSmartFoldersMock.mockResolvedValue([
      {
        id: 'folder-1',
        name: '项目集合',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: {
          version: 1,
          filters: {
            formats: ['png'],
            manualTagIds: ['11111111-1111-4111-8111-111111111111'],
          },
        },
        position: 0,
        rowVersion: 1,
      },
      {
        id: 'folder-2',
        name: '海报',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: {} },
        position: 1,
        rowVersion: 1,
      },
    ]);
    renderPage();

    const parent = await screen.findByRole('treeitem', { name: '项目集合' });
    fireEvent.click(within(parent).getByRole('button'));
    await waitFor(() =>
      expect(listEagleAssetsMock).toHaveBeenLastCalledWith(
        'token',
        expect.objectContaining({
          smartFolderId: 'folder-1',
          rules: undefined,
        }),
        expect.any(AbortSignal),
      ),
    );
    fireEvent.contextMenu(parent, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole('menuitemradio', { name: '设为绿色' }));
    await waitFor(() =>
      expect(updateEagleSmartFolderMock).toHaveBeenCalledWith('token', 'folder-1', {
        color: '#65ad78',
        rowVersion: 1,
      }),
    );

    const child = screen.getByRole('treeitem', { name: '海报' });
    fireEvent.dragStart(child);
    fireEvent.dragOver(parent);
    fireEvent.drop(parent);
    await waitFor(() =>
      expect(moveEagleSmartFolderMock).toHaveBeenCalledWith('token', 'folder-2', {
        parentId: 'folder-1',
        position: 0,
        rowVersion: 1,
      }),
    );
  });

  it('reuses recently visited folder listings instead of refetching on every switch', async () => {
    listEagleSmartFoldersMock.mockResolvedValue([
      {
        id: 'folder-1',
        name: '常用素材',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: {} },
        position: 0,
        rowVersion: 1,
      },
    ]);
    renderPage();

    await screen.findByRole('button', { name: /Owl Reference/ });
    expect(listEagleAssetsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: '常用素材' }));
    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: '常用素材' }));

    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalledTimes(2));
  });

  it('moves smart folders optimistically without waiting for asset or folder refetches', async () => {
    const folders = [
      {
        id: 'folder-1',
        name: '项目集合',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: {} },
        position: 0,
        rowVersion: 1,
      },
      {
        id: 'folder-2',
        name: '海报',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: {} },
        position: 1,
        rowVersion: 1,
      },
    ];
    const moveRequest = createDeferred<(typeof folders)[number]>();
    const folderRefresh = createDeferred<typeof folders>();
    listEagleSmartFoldersMock
      .mockResolvedValueOnce(folders)
      .mockReturnValueOnce(folderRefresh.promise);
    moveEagleSmartFolderMock.mockReturnValueOnce(moveRequest.promise);
    renderPage();

    const firstFolder = await screen.findByRole('treeitem', { name: '项目集合' });
    const secondFolder = screen.getByRole('treeitem', { name: '海报' });
    await waitFor(() => expect(listEagleAssetsMock).toHaveBeenCalledTimes(1));

    fireEvent.dragStart(secondFolder);
    fireEvent.dragOver(screen.getByTestId('smart-folder-drop-before-folder-1'));
    fireEvent.drop(screen.getByTestId('smart-folder-drop-before-folder-1'));

    await waitFor(() => expect(moveEagleSmartFolderMock).toHaveBeenCalledTimes(1));
    let optimisticOrder: Array<string | null> = [];
    await waitFor(() => {
      optimisticOrder = screen
        .getAllByRole('treeitem')
        .map((item) => item.getAttribute('aria-label'));
      expect(optimisticOrder).toEqual(['海报', '项目集合']);
    });
    expect(firstFolder).toHaveAttribute('draggable', 'false');

    await act(async () => {
      moveRequest.resolve({ ...folders[1], position: 0, rowVersion: 2 });
      await moveRequest.promise;
    });

    await waitFor(() => expect(listEagleSmartFoldersMock).toHaveBeenCalledTimes(2));
    let unlockedBeforeRefresh = false;
    try {
      await waitFor(() => expect(firstFolder).toHaveAttribute('draggable', 'true'), {
        timeout: 100,
      });
      unlockedBeforeRefresh = true;
    } catch {
      // The assertions below report the intended regression after pending work is released.
    }
    await act(async () => {
      folderRefresh.resolve(folders);
      await folderRefresh.promise;
    });

    expect(unlockedBeforeRefresh).toBe(true);
    expect(listEagleSmartFoldersMock).toHaveBeenCalledTimes(2);
    expect(listEagleAssetsMock).toHaveBeenCalledTimes(1);
  });

  it('opens smart-folder parameters from the context menu and persists edits', async () => {
    listEagleSmartFoldersMock.mockResolvedValueOnce([
      {
        id: 'folder-1',
        name: '旧名称',
        color: '#5f91d8',
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: { formats: ['png'], rating: 3 } },
        position: 0,
        rowVersion: 4,
      },
    ]);
    renderPage();

    const folder = await screen.findByRole('treeitem', { name: '旧名称' });
    fireEvent.contextMenu(folder, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: '修改文件夹参数' }));

    const dialog = screen.getByRole('dialog', { name: '修改规则' });
    expect(within(dialog).getByRole('textbox', { name: '智能文件夹名称' })).toHaveValue('旧名称');
    const groups = within(dialog).getAllByRole('region', { name: /条件组/ });
    expect(within(groups[0]!).getByRole('combobox', { name: '格式值' })).toHaveValue('png');
    expect(within(groups[1]!).getByRole('combobox', { name: '评分值' })).toHaveValue('3');
    fireEvent.change(within(dialog).getByRole('textbox', { name: '智能文件夹名称' }), {
      target: { value: '新名称' },
    });
    fireEvent.click(within(groups[0]!).getByRole('button', { name: '在规则 1 后添加规则' }));
    fireEvent.change(within(groups[0]!).getByRole('combobox', { name: '规则 2 字段' }), {
      target: { value: 'FORMAT' },
    });
    fireEvent.change(within(groups[0]!).getAllByRole('combobox', { name: '格式值' }).at(-1)!, {
      target: { value: 'webp' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存智能文件夹' }));

    await waitFor(() =>
      expect(updateEagleSmartFolderMock).toHaveBeenCalledWith(
        'token',
        'folder-1',
        expect.objectContaining({
          name: '新名称',
          query: expect.objectContaining({ version: 2 }),
          rowVersion: 4,
        }),
      ),
    );
    const update = updateEagleSmartFolderMock.mock.calls[0]?.[2] as {
      query: { conditions: Array<{ rules: Array<{ field: string; value: string }> }> };
    };
    expect(update.query.conditions[0]?.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'FORMAT', value: 'png' }),
        expect.objectContaining({ field: 'FORMAT', value: 'webp' }),
      ]),
    );
  });

  it('keeps server-owned parent folder filters out of the client query after editing', async () => {
    listEagleSmartFoldersMock.mockResolvedValueOnce([
      {
        id: 'folder-parent',
        name: '父文件夹',
        color: null,
        parentId: null,
        queryVersion: 1,
        queryJson: { version: 1, filters: { formats: ['png'] } },
        position: 0,
        rowVersion: 2,
      },
      {
        id: 'folder-child',
        name: '子文件夹',
        color: null,
        parentId: 'folder-parent',
        queryVersion: 1,
        queryJson: { version: 1, filters: { formats: ['webp'] } },
        position: 0,
        rowVersion: 1,
      },
    ]);
    renderPage();

    const parent = await screen.findByRole('treeitem', { name: '父文件夹' });
    fireEvent.click(within(parent).getByRole('button'));
    fireEvent.contextMenu(parent, { clientX: 20, clientY: 30 });
    fireEvent.click(screen.getByRole('menuitem', { name: '修改文件夹参数' }));
    fireEvent.click(screen.getByRole('button', { name: '保存智能文件夹' }));

    await waitFor(() => expect(updateEagleSmartFolderMock).toHaveBeenCalled());
    await waitFor(() => {
      const filters = listEagleAssetsMock.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(filters.smartFolderId).toBe('folder-parent');
      expect(filters.rules).toBeUndefined();
    });
  });

  it('loads the next cursor page when the masonry sentinel enters the viewport', async () => {
    listEagleAssetsMock
      .mockResolvedValueOnce({ items: [asset], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({
        items: [{ ...asset, id: 'asset-2', displayName: 'Second Owl' }],
        nextCursor: null,
      });
    renderPage();
    await screen.findByRole('button', { name: /Owl Reference/ });

    await act(async () => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(await screen.findByRole('button', { name: /Second Owl/ })).toBeInTheDocument();
    expect(listEagleAssetsMock).toHaveBeenLastCalledWith(
      'token',
      expect.objectContaining({ cursor: 'cursor-2' }),
      expect.any(AbortSignal),
    );
  });

  it('polls lightweight updates instead of reloading the full asset page', async () => {
    listEagleAssetsMock.mockResolvedValueOnce({
      items: [{ ...asset, lifecycleStatus: 'PROCESSING', renditions: [] }],
      nextCursor: null,
    });
    listEagleAssetUpdatesMock.mockResolvedValueOnce([
      {
        id: asset.id,
        lifecycleStatus: 'READY',
        mediaErrorCode: null,
        updatedAt: '2026-08-14T00:00:01.000Z',
        renditions: asset.renditions,
      },
    ]);
    renderPage();

    await waitFor(() => {
      expect(listEagleAssetUpdatesMock).toHaveBeenCalledWith(
        'token',
        ['asset-1'],
        expect.any(AbortSignal),
      );
    });
    expect(listEagleAssetsMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('处理中')).not.toBeInTheDocument();
    });
  });
  it('opens the existing editor directly from a single image context menu and saves an independent copy', async () => {
    const { client } = renderPage();
    fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑照片' }));
    await screen.findByRole('dialog', { name: '编辑照片' });
    await waitFor(() => expect(editorPropsMock.current).not.toBeNull());
    const opened = editorPropsMock.current!;
    expect(opened.source).toBe('/api/eagle/assets/asset-1/content');
    expect(screen.queryByRole('menu', { name: '素材操作' })).not.toBeInTheDocument();
    uploadEagleAssetMock.mockResolvedValueOnce({ asset: { id: 'edited-copy' } });
    const output = new File(['edited'], 'edited.png', { type: 'image/png' });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await act(async () => {
      expect(await opened.onSave(output)).toEqual({ id: 'edited-copy', name: 'edited.png' });
    });
    expect(uploadEagleAssetMock).toHaveBeenCalledWith('token', output, expect.any(Function), {
      duplicatePolicy: 'CREATE_COPY',
      copySourceAssetId: asset.id,
      copySourceRowVersion: asset.rowVersion,
      retry: true,
    });
    expect(invalidate).toHaveBeenCalled();
  });

  it('offers image editing in the inspector and dismisses it when the authenticated owner changes', async () => {
    const view = renderPage();
    const inspector = await selectAssetAndOpenInspector();
    fireEvent.click(within(inspector).getByRole('button', { name: '编辑照片' }));
    await screen.findByRole('dialog', { name: '编辑照片' });
    view.rerender(view.renderForOwner('different-owner'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑照片' })).not.toBeInTheDocument(),
    );
  });
  it('enters explicit selection after a modifier gesture and opens the shared management menu', async () => {
    listEagleAssetsMock.mockResolvedValue({
      items: [asset, { ...asset, id: 'asset-2', displayName: 'Second Asset' }],
      nextCursor: null,
    });
    renderPage();
    const first = await screen.findByRole('button', { name: /Owl Reference/ });
    const second = screen.getByRole('button', { name: /Second Asset/ });
    expect(screen.queryByRole('toolbar', { name: '图片选择' })).not.toBeInTheDocument();
    fireEvent.click(first, { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(second);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '操作' }));
    const menu = screen.getByRole('menu', { name: '素材操作' });
    expect(menu).toHaveTextContent('已选择 2 项');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '删除所选素材' }));
    await waitFor(() =>
      expect(enqueueAssetOperationMock).toHaveBeenCalledWith({
        kind: 'TRASH',
        assetIds: ['asset-1', 'asset-2'],
        operationId: expect.any(String),
      }),
    );
  });
  it('provides a file picker that can import the same file again after completion', async () => {
    renderPage();
    const input = screen.getByLabelText('选择导入文件');
    const file = new File(['synthetic'], 'camera.NEF', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadEagleAssetMock).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadEagleAssetMock).toHaveBeenCalledTimes(2));
    expect(input).toHaveAttribute('multiple');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.nef'));
  });
  it('provides previous and next buttons for ordinary previews using the same gallery order', async () => {
    listEagleAssetsMock.mockResolvedValue({
      items: [asset, { ...asset, id: 'asset-2', displayName: 'Second Asset' }],
      nextCursor: null,
    });
    renderPage();
    fireEvent.doubleClick(await screen.findByRole('button', { name: /Owl Reference/ }));
    expect(await screen.findByRole('dialog', { name: 'Owl Reference' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一张' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(await screen.findByRole('dialog', { name: 'Second Asset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张' })).toBeDisabled();
  });

  it('opens images with one tap on phones without exposing idle batch actions', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const view = renderPage();
    try {
      expect(screen.queryByRole('button', { name: '操作' })).not.toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }));
      expect(await screen.findByRole('dialog', { name: 'Owl Reference' })).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
  it('uses phone long press to enter selection before exposing management actions', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const view = renderPage();
    try {
      fireEvent.contextMenu(await screen.findByRole('button', { name: /Owl Reference/ }));
      expect(screen.getByRole('button', { name: '取消选择' })).toBeInTheDocument();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '操作' }));
      expect(screen.getByRole('menu')).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('keeps material destinations in the three-dot menu and closes it after navigation', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const view = renderPage();
    try {
      expect(screen.queryByRole('button', { name: '标签' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '更多' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
      fireEvent.click(
        within(
          within(screen.getByRole('dialog')).getByRole('navigation', { name: '主导航' }),
        ).getByRole('button', { name: '标签' }),
      );
      expect(screen.getByRole('region', { name: '标签' })).toBeVisible();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '更多' }));
      expect(screen.getByRole('region', { name: '更多' })).toBeVisible();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
      if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
    }
  });

  it('puts library management behind the phone three-dot sheet without a hamburger', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
    const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
    const view = renderPage();
    try {
      expect(screen.queryByRole('button', { name: '打开导航' })).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: '更多操作' });
      expect(screen.queryByRole('button', { name: '回收站' })).not.toBeInTheDocument();
      fireEvent.click(toggle);
      const drawer = screen.getByRole('dialog', { name: '更多操作' });
      fireEvent.click(within(drawer).getByText('图库管理'));
      fireEvent.click(within(drawer).getByRole('button', { name: '回收站' }));
      await waitFor(() => expect(listEagleTrashMock).toHaveBeenCalled());
      expect(screen.queryByRole('dialog', { name: '更多操作' })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      if (show) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', show);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
      if (close) Object.defineProperty(HTMLDialogElement.prototype, 'close', close);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
      vi.unstubAllGlobals();
    }
  });
  it('focuses the explicit action menu, supports menu keys and returns focus to its trigger', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Owl Reference/ }), {
      ctrlKey: true,
    });
    const trigger = screen.getByRole('button', { name: '操作' });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '素材操作' });
    expect(within(menu).getByRole('menuitem', { name: '收藏' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(within(menu).getByRole('menuitem', { name: '删除所选素材' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it('opens photos and videos outside the loaded timeline through the shared viewer and uses location-page navigation', async () => {
    testWorkspaceMode.value = 'PHOTO';
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '地图' }));
    fireEvent.click(await screen.findByRole('button', { name: '测试地图组照片' }));
    expect(await screen.findByRole('dialog', { name: 'Map Photo A' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一张' }));
    expect(await screen.findByRole('dialog', { name: 'Map Photo B' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '测试地图组视频' }));
    expect(await screen.findByRole('dialog', { name: 'Map Video' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '载入更多照片' })).not.toBeInTheDocument();
    view.rerender(view.renderForOwner('another-owner'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Map Video' })).not.toBeInTheDocument(),
    );
  });
});
