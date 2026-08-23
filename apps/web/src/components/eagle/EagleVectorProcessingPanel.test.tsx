import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../lib/eagle-vector-api';
import { EagleVectorProcessingPanel } from './EagleVectorProcessingPanel';

vi.mock('../../lib/eagle-vector-api', () => ({
  fetchEagleVectorSummary: vi.fn(),
  retryFailedEagleEmbeddings: vi.fn(),
  scanMissingEagleEmbeddings: vi.fn(),
}));

describe('EagleVectorProcessingPanel', () => {
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
      tags: { enabled: 16, ready: 12, awaitingCenter: 4 },
      suggestions: { unclassified: 4, pending: 0 },
      host: { status: 'ONLINE' },
      refreshedAt: '2026-08-19T00:00:00Z',
    });
    vi.mocked(api.scanMissingEagleEmbeddings).mockResolvedValue({
      scanned: 5,
      created: 5,
      repaired: 0,
    });
  });

  it('shows only operational image-vector state and repair actions', async () => {
    render(<EagleVectorProcessingPanel />);

    expect(await screen.findByRole('heading', { name: '图片向量' })).toBeInTheDocument();
    expect(screen.getByText('等待 12 · 运行 2 · 未入队 5')).toBeInTheDocument();
    expect(screen.getByText('夜间 23:00–06:00 执行')).toBeInTheDocument();
    expect(screen.queryByText('智能标签确认')).not.toBeInTheDocument();
    expect(screen.queryByText('标签推荐设置')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '扫描缺失向量' }));
    expect(await screen.findByRole('status')).toHaveTextContent('已排队 5 个缺失图片向量');
  });
});
