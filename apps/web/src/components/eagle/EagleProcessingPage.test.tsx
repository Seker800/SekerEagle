import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EagleProcessingPage } from './EagleProcessingPage';
import * as api from '../../lib/eagle-processing-admin-api';

vi.mock('../../lib/eagle-processing-admin-api', () => ({
  fetchEagleProcessingSummary: vi.fn(),
  listEagleProcessingJobs: vi.fn(),
  updateEagleProcessingSettings: vi.fn(),
  retryEagleProcessingJob: vi.fn(),
  retryAllFailedEagleProcessingJobs: vi.fn(),
  reconcileEagleProcessingJobs: vi.fn(),
}));

const summary = {
  worker: {
    status: 'ONLINE' as const,
    count: 1,
    activeJobCount: 1,
    lastHeartbeatAt: '2026-08-14T12:00:00.000Z',
    version: 'v1',
  },
  counts: { running: 1, queued: 4, failed: 2, completedLast24Hours: 12 },
  queues: [
    { lane: 'INTERACTIVE' as const, queued: 1, running: 1, failed: 0 },
    { lane: 'BACKGROUND' as const, queued: 3, running: 0, failed: 2 },
    { lane: 'MAINTENANCE' as const, queued: 0, running: 0, failed: 0 },
  ],
  colorCoverage: {
    processorVersion: 'color-v2',
    eligible: 10,
    completed: 7,
    processing: 2,
    failed: 0,
    percentage: 70,
  },
  settings: {
    mode: 'NIGHT' as const,
    nightStart: '23:00',
    nightEnd: '06:00',
    timeZone: 'Asia/Shanghai' as const,
  },
  refreshedAt: '2026-08-14T12:00:00.000Z',
};

describe('EagleProcessingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchEagleProcessingSummary).mockResolvedValue(summary);
    vi.mocked(api.listEagleProcessingJobs).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('shows worker, queue metrics and background schedule', async () => {
    render(<EagleProcessingPage accessToken="token" />);
    expect(await screen.findByText('在线')).toBeInTheDocument();
    expect(screen.getByText('等待中')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('23:00')).toBeInTheDocument();
  });

  it('separates supported capabilities, current queue and processing history', async () => {
    render(<EagleProcessingPage accessToken="token" />);

    const capabilities = await screen.findByRole('region', { name: '处理能力' });
    expect(
      within(capabilities).getByRole('heading', { name: '缩略图与预览图' }),
    ).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: '图像颜色分析' })).toBeInTheDocument();
    expect(within(capabilities).getByText('补算中 70%')).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: '媒体信息检测' })).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: 'AI 自动标签' })).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: '素材永久清理' })).toBeInTheDocument();
    expect(within(capabilities).getByText('尚未启用')).toBeInTheDocument();
    expect(within(capabilities).getAllByTestId('processing-capability')).toHaveLength(5);

    expect(screen.getByRole('region', { name: '当前队列' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '处理记录' })).toBeInTheDocument();
  });

  it('keeps API errors distinct from an empty queue', async () => {
    vi.mocked(api.fetchEagleProcessingSummary).mockRejectedValueOnce(new Error('后端暂不可用'));
    render(<EagleProcessingPage accessToken="token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('后端暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(api.fetchEagleProcessingSummary).toHaveBeenCalledTimes(2));
  });
});

