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

  it('states the Ollama boundary and confirms vector suggestions into manual tags', async () => {
    render(<EagleVectorWorkspace />);
    expect(
      await screen.findByText('AI 自动标签未来由 Ollama 视觉模型独立生成，并写入 AI 标签体系。'),
    ).toBeInTheDocument();
    expect(screen.getByText('建议：汽车')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() =>
      expect(api.reviewEagleVectorSuggestions).toHaveBeenCalledWith(['suggestion-1'], 'ACCEPT'),
    );
  });

  it('reuses the full tag picker search so owners can browse and find tags by pinyin', async () => {
    render(<EagleVectorWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: /标签推荐设置/ }));
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

  it('shows real queue state and reports how many missing vectors were enqueued', async () => {
    render(<EagleVectorWorkspace />);
    expect(await screen.findByText('等待 12 · 运行 2 · 未入队 5')).toBeInTheDocument();
    expect(screen.getByText('夜间 23:00–06:00 执行')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '扫描缺失向量' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已排队 5 个缺失图片向量');
  });
});
