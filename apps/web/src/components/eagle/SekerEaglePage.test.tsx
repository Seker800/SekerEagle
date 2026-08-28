import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('openseadragon', () => ({ default: openSeadragonMock }));

vi.mock('../media/loading/thumbnailLoadService', () => ({
  ThumbnailLoadError: class ThumbnailLoadError extends Error {},
  ThumbnailLoadService: class ThumbnailLoadService {
    async load(_key: string, url: string) {
      return { url, release: () => undefined };
    }
    dispose() {}
  },
}));

const listEagleAssetsMock = vi.fn();
const getEagleAssetMock = vi.fn();
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
const batchSetEagleAssetPrivacyMock = vi.fn();
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
  getEagleAssetContentUrl: (assetId: string) => `/api/eagle/assets/${assetId}/content`,
  getEagleRenditionContentUrl: (assetId: string, renditionId: string) =>
    `/api/eagle/assets/${assetId}/renditions/${renditionId}/content`,
  getEaglePyramidDescriptor: (...args: unknown[]) => getEaglePyramidDescriptorMock(...args),
  countEagleAssets: (...args: unknown[]) => countEagleAssetsMock(...args),
  listEagleAssets: (...args: unknown[]) => listEagleAssetsMock(...args),
  getEagleAsset: (...args: unknown[]) => getEagleAssetMock(...args),
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
  batchSetEagleAssetPrivacy: (...args: unknown[]) => batchSetEagleAssetPrivacyMock(...args),
  uploadEagleAsset: (...args: unknown[]) => uploadEagleAssetMock(...args),
  listEagleSmartFolders: (...args: unknown[]) => listEagleSmartFoldersMock(...args),
  createEagleSmartFolder: (...args: unknown[]) => createEagleSmartFolderMock(...args),
  updateEagleSmartFolder: (...args: unknown[]) => updateEagleSmartFolderMock(...args),
  moveEagleSmartFolder: (...args: unknown[]) => moveEagleSmartFolderMock(...args),
}));

vi.mock('./EagleProcessingPage', () => ({
  EagleProcessingPage: () => <div data-testid="eagle-processing-page">素材处理状态</div>,
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
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = (currentOwnerId: string) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SekerEaglePage
          accessToken="token"
          ownerId={currentOwnerId}
          canManageProcessing={canManageProcessing}
          privacyVisibility={privacyVisibility}
        />
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
  beforeEach(() => {
    vi.clearAllMocks();
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
      assetId: 'asset-1',
      tagIds: ['11111111-1111-4111-8111-111111111111'],
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
    batchChangeEagleManualTagsMock.mockResolvedValue({ affectedAssetCount: 1 });
    listEagleTrashMock.mockResolvedValue({
      items: [{ ...asset, deletedAt: '2026-08-14T01:00:00.000Z' }],
      nextCursor: null,
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
    batchSetEagleAssetPrivacyMock.mockResolvedValue({
      affectedAssetCount: 1,
      assets: [{ assetId: 'asset-1', rowVersion: 2 }],
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

  it('keeps inspector visibility independent from the current asset selection', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '全部素材' })).toBeInTheDocument();
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

  it('opens the account view inside the library workspace without replacing the sidebar', async () => {
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

    await screen.findByRole('heading', { name: '全部素材' });
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    const accountButton = within(screen.getByRole('navigation', { name: '素材库导航' })).getByRole(
      'button',
      { name: '个人账号' },
    );
    fireEvent.click(accountButton);
    expect(screen.getByRole('navigation', { name: '素材库导航' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '个人账号' })).toBeInTheDocument();
    expect(screen.getByTestId('embedded-account-view')).toBeInTheDocument();
  });

  it('opens asset processing from the SekerEagle navigation', async () => {
    renderPage('owner-test', true);

    fireEvent.click(await screen.findByRole('button', { name: '素材处理' }));

    expect(screen.getByTestId('eagle-processing-page')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '素材处理' })).toBeInTheDocument();
  });

  it('keeps the material-processing entry available for ordinary owners', async () => {
    renderPage();

    await screen.findByRole('heading', { name: '全部素材' });
    expect(screen.getByRole('button', { name: '素材处理' })).toBeInTheDocument();
  });

  it('changes and persists the thumbnail size', async () => {
    renderPage();

    const slider = await screen.findByRole('slider', { name: '缩略图大小' });
    expect(slider).toHaveAttribute('min', '140');
    expect(slider).toHaveAttribute('max', '320');
    expect(slider).toHaveValue('210');

    fireEvent.change(slider, { target: { value: '320' } });

    expect(slider).toHaveValue('320');
    expect(window.localStorage.getItem('seker-eagle.preferences.v1')).toContain('320');
  });

  it('applies common filters from a dedicated quick-filter popover', async () => {
    renderPage();

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

    fireEvent.click(await screen.findByRole('button', { name: '标签筛选' }));
    const filterPanel = screen.getByRole('dialog', { name: '标签筛选' });
    const manualTagSearch = within(filterPanel).getByRole('searchbox', { name: '搜索标签' });

    expect(within(filterPanel).getAllByRole('checkbox').length).toBeLessThanOrEqual(100);
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

    fireEvent.click(await screen.findByRole('button', { name: '人工标签' }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: /人工标签 灵感/ }));
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

    fireEvent.click(screen.getByRole('button', { name: 'AI 自动标签' }));
    fireEvent.doubleClick(await screen.findByRole('button', { name: /AI标签 猫头鹰/ }));
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
      '另存为…',
      '复制图片',
      '添加标签',
      '删除人工标签',
      '设为隐私',
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

  it('shows the temporary privacy view and marks selected assets private from the context menu', async () => {
    renderPage('owner-test', false, {
      enabled: true,
      durationHours: 3,
      expiresAt: '2026-08-19T15:00:00.000Z',
    });

    expect(await screen.findByRole('button', { name: '隐私素材' })).toBeInTheDocument();
    expect(screen.getByText('隐私内容已显示')).toBeInTheDocument();
    const card = await screen.findByRole('button', { name: /Owl Reference/ });
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: '设为隐私' }));

    await waitFor(() =>
      expect(batchSetEagleAssetPrivacyMock).toHaveBeenCalledWith('token', {
        assets: [{ assetId: 'asset-1', rowVersion: 1 }],
        isPrivate: true,
      }),
    );
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
      expect(batchTrashEagleAssetsMock).toHaveBeenCalledWith('token', ['asset-1']),
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
      expect(batchRestoreEagleAssetsMock).toHaveBeenCalledWith('token', ['asset-1']),
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
      expect(batchRestoreEagleAssetsMock).toHaveBeenCalledWith('token', ['asset-1']);
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
    await waitFor(() => expect(emptyEagleTrashMock).toHaveBeenCalledWith('token'));
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
    expect(screen.getByText(/滚轮缩放/)).toBeInTheDocument();
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

  it('uses Ctrl and Command clicks to toggle batch selection without a mode button', async () => {
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
    fireEvent.click(firstCard);
    fireEvent.click(secondCard, { ctrlKey: true });
    fireEvent.click(thirdCard, { metaKey: true });

    expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
    expect(thirdCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('toolbar', { name: '批量操作' })).not.toBeInTheDocument();
    fireEvent.contextMenu(thirdCard);
    expect(screen.getByRole('menu', { name: '素材操作' })).toHaveTextContent('已选择 3 项');
    expect(screen.queryByRole('button', { name: '进入多选' })).not.toBeInTheDocument();
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

    expect(await screen.findByRole('alert')).toHaveTextContent('目标文件夹不可写');
  });

  it('primes selected originals and starts them on the first drag gesture', async () => {
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
    await waitFor(() => expect(prepareAssetDrag).toHaveBeenCalledWith(['asset-1', 'asset-2']));
    expect(firstCard).toHaveAttribute('aria-pressed', 'true');
    expect(secondCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('正在准备 2 个原文件…')).not.toBeInTheDocument();

    pendingDrag.resolve();
    await waitFor(() => expect(prepareAssetDrag).toHaveReturned());
    fireEvent.dragStart(secondCard);
    expect(startPreparedAssetDrag).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
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
    await waitFor(() => expect(prepareAssetDrag).toHaveBeenCalledWith(['asset-1']));
    fireEvent.dragStart(card);
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

  it('removes file-picker entry points while retaining drag-and-drop import', async () => {
    const { container } = renderPage();
    await screen.findByRole('heading', { name: '全部素材' });

    expect(screen.queryByRole('button', { name: '导入' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择文件' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).not.toBeInTheDocument();

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
    await screen.findByRole('heading', { name: '全部素材' });
    const listCallsBeforeDrop = listEagleAssetsMock.mock.calls.length;

    fireEvent.drop(screen.getByRole('main'), {
      dataTransfer: { files: [new File(['duplicate'], 'duplicate.png', { type: 'image/png' })] },
    });

    await waitFor(() =>
      expect(listEagleAssetsMock.mock.calls.length).toBeGreaterThan(listCallsBeforeDrop),
    );
    expect(screen.queryByText('导入完成，跳过 1 个重复素材')).not.toBeInTheDocument();
  });

  it('shows the Eagle-style quick-filter toolbar without a generic rule-builder button', async () => {
    renderPage();
    await screen.findByRole('heading', { name: '全部素材' });

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

  it('opens separate manual and AI tag pages instead of expanding tags in the sidebar', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '人工标签' }));
    expect(screen.getByRole('heading', { name: '人工标签' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '人工标签管理' })).toHaveTextContent('灵感');

    fireEvent.click(screen.getByRole('button', { name: 'AI 自动标签' }));
    expect(screen.getByRole('heading', { name: 'AI 自动标签' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'AI 标签管理' })).toHaveTextContent('猫头鹰');
  });

  it('exposes the three smart-tag workflows directly below the tag entries with live counts', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '智能标签确认 32' }));
    expect(screen.getByTestId('eagle-vector-workspace')).toHaveAttribute('data-view', 'REVIEW');

    fireEvent.click(screen.getByRole('button', { name: '标签推荐设置 15' }));
    expect(screen.getByTestId('eagle-vector-workspace')).toHaveAttribute('data-view', 'TAGS');

    fireEvent.click(screen.getByRole('button', { name: '待手动分类 6' }));
    expect(screen.getByTestId('eagle-vector-workspace')).toHaveAttribute(
      'data-view',
      'UNCLASSIFIED',
    );
  });

  it('connects smart-tag context deletion to the shared trash mutation', async () => {
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '智能标签确认 32' }));
    fireEvent.click(screen.getByRole('button', { name: '测试智能标签删除' }));

    await waitFor(() =>
      expect(batchTrashEagleAssetsMock).toHaveBeenCalledWith('token', ['asset-1']),
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
});
