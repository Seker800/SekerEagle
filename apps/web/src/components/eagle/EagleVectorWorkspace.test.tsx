import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../lib/eagle-vector-api';
import { EagleVectorWorkspace } from './EagleVectorWorkspace';

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

const tag = {
  id: 'tag-1',
  name: '汽车',
  color: '#dc8039',
  assetCount: 1286,
  recommendationEnabled: false,
  currentSnapshotId: null,
  lastGeneratedAt: null,
  activeBuild: null,
  currentSnapshot: null,
  pendingSuggestionCount: 0,
};

describe('EagleVectorWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchEagleVectorSummary).mockResolvedValue({
      model: 'Qwen/Qwen3-VL-Embedding-2B',
      dimensions: 1024,
      embeddingCoverage: { eligible: 100, ready: 80, failed: 1, processing: 19, percentage: 80 },
      tags: { enabled: 0, ready: 0, awaitingCenter: 0 },
      suggestions: { unclassified: 4, pending: 1 },
      host: { status: 'ONLINE' },
      refreshedAt: '2026-08-19T00:00:00Z',
    });
    vi.mocked(api.listEagleVectorTags).mockResolvedValue([tag]);
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

  it('keeps every tag disabled until the owner explicitly opts in', async () => {
    render(<EagleVectorWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: /标签推荐设置/ }));
    expect(screen.queryByRole('checkbox', { name: /参与智能推荐/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '筛选标签状态' }), {
      target: { value: 'DISABLED' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '搜索人工标签' }), {
      target: { value: '汽车' },
    });
    const toggle = screen.getByRole('checkbox', { name: /参与智能推荐/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.setEagleVectorTagEnabled).toHaveBeenCalledWith('tag-1', true));
  });
});
