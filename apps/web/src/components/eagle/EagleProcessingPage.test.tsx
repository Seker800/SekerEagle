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
vi.mock('./EagleVectorProcessingPanel', () => ({
  EagleVectorProcessingPanel: () => <div data-testid="vector-processing-panel">图片向量状态</div>,
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
    fireEvent.click(screen.getByRole('button', { name: /任务中心/ }));
    expect(screen.getByText('等待中')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('23:00')).toBeInTheDocument();
  });

  it('shows owners an operational vector status without nesting labeling workflows', () => {
    render(<EagleProcessingPage canManageProcessing={false} />);

    expect(screen.getByTestId('vector-processing-panel')).toBeVisible();
    expect(screen.queryByText('智能标签确认')).not.toBeInTheDocument();
    expect(screen.queryByText('标签推荐设置')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(api.fetchEagleProcessingSummary).not.toHaveBeenCalled();
    expect(api.listEagleProcessingJobs).not.toHaveBeenCalled();
  });

  it('groups user-facing outcomes separately from operational task views', async () => {
    render(<EagleProcessingPage accessToken="token" />);

    await screen.findByText('在线');
    const navigation = screen.getByRole('navigation', { name: '素材处理功能' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(3);
    expect(within(navigation).getByRole('button', { name: /浏览优化/ })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.keyDown(within(navigation).getByRole('button', { name: /浏览优化/ }), {
      key: 'ArrowRight',
    });
    expect(within(navigation).getByRole('button', { name: /颜色筛选/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(navigation).getByRole('button', { name: /浏览优化/ }));

    const capabilities = screen.getByRole('region', { name: /浏览优化/ });
    expect(
      within(capabilities).getByRole('heading', { name: '缩略图与预览图' }),
    ).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: '媒体信息检测' })).toBeInTheDocument();
    expect(within(capabilities).getByRole('heading', { name: '大图缩放切片' })).toBeInTheDocument();
    expect(within(capabilities).getAllByTestId('processing-capability')).toHaveLength(3);

    fireEvent.click(within(navigation).getByRole('button', { name: /颜色筛选/ }));
    const colorPanel = screen.getByRole('region', { name: /颜色筛选/ });
    expect(within(colorPanel).getByText('补算中 70%')).toBeVisible();
    expect(within(colorPanel).getByText('70%')).toBeVisible();

    expect(within(navigation).queryByRole('button', { name: /标签推荐/ })).not.toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole('button', { name: /图片向量/ }));
    expect(screen.getByRole('region', { name: /图片向量/ })).toBeVisible();
    expect(screen.getByTestId('vector-processing-panel')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /任务中心/ }));
    const taskCenter = screen.getByRole('region', { name: '任务中心' });
    expect(screen.getByRole('heading', { name: '当前队列' })).toBeVisible();

    const taskTabs = within(taskCenter).getByRole('tablist', { name: '任务中心视图' });
    fireEvent.click(within(taskTabs).getByRole('tab', { name: '处理记录' }));
    expect(screen.getByRole('heading', { name: '处理记录' })).toBeVisible();
  });

  it('keeps API errors distinct from an empty queue', async () => {
    vi.mocked(api.fetchEagleProcessingSummary).mockRejectedValueOnce(new Error('后端暂不可用'));
    render(<EagleProcessingPage accessToken="token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('后端暂不可用');
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(api.fetchEagleProcessingSummary).toHaveBeenCalledTimes(2));
  });
});
