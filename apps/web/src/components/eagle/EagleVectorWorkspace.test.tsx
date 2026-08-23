import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as eagleApi from '../../lib/eagle-api';
import * as api from '../../lib/eagle-vector-api';
import { EagleVectorWorkspace } from './EagleVectorWorkspace';

vi.mock('../../lib/eagle-api', () => ({
  listEagleManualTags: vi.fn(),
}));

vi.mock('../../lib/eagle-vector-api', () => ({
  fetchEagleVectorSummary: vi.fn(),
  listEagleVectorTags: vi.fn(),
  listEagleVectorSuggestions: vi.fn(),
  listEagleUnclassifiedAssets: vi.fn(),
  listEagleTagDistanceAssets: vi.fn(),
  setEagleVectorTagEnabled: vi.fn(),
  rebuildEagleVectorTag: vi.fn(),
  reviewEagleVectorSuggestions: vi.fn(),
  retryFailedEagleEmbeddings: vi.fn(),
  scanMissingEagleEmbeddings: vi.fn(),
  getVectorThumbnailUrl: vi.fn(() => '/thumbnail'),
}));

describe('EagleVectorWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchEagleVectorSummary).mockResolvedValue({
      model: 'Qwen/Qwen3-VL-Embedding-2B',
      dimensions: 1024,
      embeddingCoverage: {
        eligible: 100,
        ready: 80,
        failed: 1,
        queued: 12,
        running: 2,
        missing: 5,
        blocked: 0,
        processing: 14,
        percentage: 80,
      },
      processingSchedule: {
        mode: 'NIGHT',
        nightStart: '23:00',
        nightEnd: '06:00',
        timeZone: 'Asia/Shanghai',
      },
      tags: { enabled: 0, ready: 0, awaitingCenter: 0 },
      suggestions: { unclassified: 4, pending: 1 },
      host: { status: 'ONLINE' },
      refreshedAt: '2026-08-19T00:00:00Z',
    });
    vi.mocked(api.listEagleVectorTags).mockResolvedValue([]);
    vi.mocked(eagleApi.listEagleManualTags).mockResolvedValue([
      {
        id: 'night',
        name: '夜间氛围',
        color: null,
        groupId: null,
        groupIds: [],
        isStarred: false,
        rowVersion: 1,
        assetCount: 18,
        pinyin: 'ye jian fen wei',
        pinyinInitials: 'yjfw',
      },
      {
        id: 'driver',
        name: '驾驶',
        color: '#79818c',
        groupId: null,
        groupIds: [],
        isStarred: false,
        rowVersion: 1,
        assetCount: 42,
        pinyin: 'jia shi',
        pinyinInitials: 'js',
      },
    ]);
    vi.mocked(api.listEagleVectorSuggestions).mockResolvedValue({
      items: [
        {
          id: 'suggestion-1',
          score: 0.91,
          distance: 0.09,
          prototypeRank: 0,
          createdAt: '2026-08-19T00:00:00Z',
          suggestedTag: { id: 'tag-1', name: '汽车', color: null },
          asset: {
            id: 'asset-1',
            displayName: 'red-car.jpg',
            width: 800,
            height: 600,
            renditions: [],
          },
          representativeAssets: [],
        },
      ],
      nextCursor: null,
    });
    vi.mocked(api.listEagleUnclassifiedAssets).mockResolvedValue({ items: [], nextCursor: null });
    vi.mocked(api.setEagleVectorTagEnabled).mockResolvedValue({});
    vi.mocked(api.reviewEagleVectorSuggestions).mockResolvedValue({ items: [] });
    vi.mocked(api.scanMissingEagleEmbeddings).mockResolvedValue({
      scanned: 5,
      created: 5,
      repaired: 0,
    });
  });

  it('states the manual-tag boundary and confirms vector suggestions into manual tags', async () => {
    render(<EagleVectorWorkspace />);
    expect(
      await screen.findByText('这里审核的是已有人工标签的向量推荐，不会写入 AI 自动标签。'),
    ).toBeInTheDocument();
    expect(screen.getByText('建议：汽车')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() =>
      expect(api.reviewEagleVectorSuggestions).toHaveBeenCalledWith(['suggestion-1'], 'ACCEPT'),
    );
  });

  it('matches the library single, command-toggle, shift-range, and background-clear selection gestures', async () => {
    vi.mocked(api.listEagleVectorSuggestions).mockResolvedValue({
      items: [
        {
          id: 'suggestion-1',
          score: 0.91,
          distance: 0.09,
          prototypeRank: 0,
          createdAt: '2026-08-19T00:00:00Z',
          suggestedTag: { id: 'tag-1', name: '汽车', color: null },
          asset: {
            id: 'asset-1',
            displayName: 'red-car.jpg',
            width: 800,
            height: 600,
            renditions: [],
          },
          representativeAssets: [],
        },
        {
          id: 'suggestion-2',
          score: 0.89,
          distance: 0.11,
          prototypeRank: 0,
          createdAt: '2026-08-19T00:00:01Z',
          suggestedTag: { id: 'tag-2', name: '夜景', color: null },
          asset: {
            id: 'asset-2',
            displayName: 'night-road.jpg',
            width: 800,
            height: 600,
            renditions: [],
          },
          representativeAssets: [],
        },
        {
          id: 'suggestion-3',
          score: 0.87,
          distance: 0.13,
          prototypeRank: 0,
          createdAt: '2026-08-19T00:00:02Z',
          suggestedTag: { id: 'tag-3', name: '城市', color: null },
          asset: {
            id: 'asset-3',
            displayName: 'city-light.jpg',
            width: 800,
            height: 600,
            renditions: [],
          },
          representativeAssets: [],
        },
      ],
      nextCursor: null,
    });

    render(<EagleVectorWorkspace />);
    const grid = await screen.findByRole('grid', { name: '待确认的智能标签建议' });
    const first = within(grid).getByRole('button', { name: /red-car\.jpg/ });
    const second = within(grid).getByRole('button', { name: /night-road\.jpg/ });
    const third = within(grid).getByRole('button', { name: /city-light\.jpg/ });

    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');

    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() =>
      expect(vi.mocked(api.listEagleVectorSuggestions).mock.calls.length).toBeGreaterThan(1),
    );
    expect(first).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(third, { metaKey: true });
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(third).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(second, { shiftKey: true });
    expect(first).toHaveAttribute('aria-pressed', 'false');
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(third).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(grid);
    expect(second).toHaveAttribute('aria-pressed', 'false');
    expect(third).toHaveAttribute('aria-pressed', 'false');
  });

  it('reuses the full tag picker search so owners can browse and find tags by pinyin', async () => {
    render(<EagleVectorWorkspace view="TAGS" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('还没有参与推荐的标签，请从上方搜索并添加。')).toBeInTheDocument();
    expect(await screen.findByText('驾驶')).toBeInTheDocument();
    expect(
      within(screen.getByLabelText('可添加的标签列表')).getAllByRole('button')[0],
    ).toHaveAccessibleName('添加驾驶到标签推荐');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索可添加的人工标签' }), {
      target: { value: 'js' },
    });
    expect(screen.getByText('驾驶')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索可添加的人工标签' }), {
      target: { value: '驾驶' },
    });
    expect(screen.getByText('驾驶')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索可添加的人工标签' }), {
      target: { value: 'jiashi' },
    });
    expect(screen.getByText('驾驶')).toBeInTheDocument();
    expect(screen.queryByText('夜间氛围')).not.toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: '添加驾驶到标签推荐' });
    fireEvent.click(addButton);
    await waitFor(() => expect(api.setEagleVectorTagEnabled).toHaveBeenCalledWith('driver', true));
  });

  it('renders one focused workflow without nesting the three peer entries again', async () => {
    render(<EagleVectorWorkspace view="REVIEW" />);

    expect(await screen.findByRole('heading', { name: '智能标签确认' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '向量处理视图' })).not.toBeInTheDocument();
    expect(screen.queryByText(/标签推荐设置/)).not.toBeInTheDocument();
    expect(screen.queryByText(/待手动分类/)).not.toBeInTheDocument();
  });

  it('lets owners classify selected fallback assets from a visible action or the context menu', async () => {
    vi.mocked(api.listEagleUnclassifiedAssets).mockResolvedValue({
      items: [
        {
          id: 'asset-unclassified',
          displayName: 'unclassified.jpg',
          width: 800,
          height: 600,
          renditions: [],
          embeddings: [],
        },
      ],
      nextCursor: null,
    });
    const assignManualTags = vi.fn().mockResolvedValue(undefined);

    render(
      <EagleVectorWorkspace
        view="UNCLASSIFIED"
        manualTags={[
          {
            id: 'driver',
            name: '驾驶',
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            assetCount: 42,
            pinyin: 'jia shi',
            pinyinInitials: 'js',
          },
        ]}
        onAssignManualTags={assignManualTags}
      />,
    );

    const card = await screen.findByRole('button', { name: '选择 unclassified.jpg' });
    fireEvent.click(card);
    fireEvent.click(screen.getByRole('button', { name: '添加人工标签' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '驾驶' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 1 个标签到 1 项素材' }));
    await waitFor(() =>
      expect(assignManualTags).toHaveBeenCalledWith(['asset-unclassified'], ['driver']),
    );

    fireEvent.contextMenu(card, { clientX: 120, clientY: 160 });
    expect(screen.getByRole('menuitem', { name: '添加人工标签' })).toBeInTheDocument();
  });

  it('rejects the current recommendation before assigning a different manual tag', async () => {
    const assignManualTags = vi.fn().mockResolvedValue(undefined);
    render(
      <EagleVectorWorkspace
        view="REVIEW"
        manualTags={[
          {
            id: 'night',
            name: '夜间氛围',
            color: null,
            groupId: null,
            groupIds: [],
            isStarred: false,
            rowVersion: 1,
            assetCount: 18,
            pinyin: 'ye jian fen wei',
            pinyinInitials: 'yjfw',
          },
        ]}
        onAssignManualTags={assignManualTags}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /选择 red-car\.jpg/ }));
    fireEvent.click(screen.getByRole('button', { name: '指定其他标签' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '夜间氛围' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 1 个标签到 1 项素材' }));

    await waitFor(() => {
      expect(api.reviewEagleVectorSuggestions).toHaveBeenCalledWith(['suggestion-1'], 'REJECT');
      expect(assignManualTags).toHaveBeenCalledWith(['asset-1'], ['night']);
    });
    expect(
      vi.mocked(api.reviewEagleVectorSuggestions).mock.invocationCallOrder.at(-1),
    ).toBeLessThan(assignManualTags.mock.invocationCallOrder[0]);
  });
});
