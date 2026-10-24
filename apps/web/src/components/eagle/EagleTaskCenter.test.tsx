import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import * as api from '../../lib/eagle-task-center-api';
import { EagleTaskCenter } from './EagleTaskCenter';

vi.mock('../../lib/eagle-task-center-api', () => ({
  fetchEagleTaskCenter: vi.fn(),
  updateEagleTaskSchedule: vi.fn(),
  retryEagleTaskFamily: vi.fn(),
  updateEagleTaskPolicy: vi.fn(),
  createEagleTaskCenterApi: vi.fn(),
}));
vi.mock('./EagleProcessingPage', () => ({ EagleProcessingPage: () => <div>处理记录详情</div> }));
const summary = {
  worker: 'ONLINE' as const,
  settings: {
    mode: 'NIGHT',
    nightStart: '23:00',
    nightEnd: '06:00',
    timeZone: 'Asia/Shanghai' as const,
  },
  refreshedAt: '2026-10-24T04:00:00Z',
  groups: [
    {
      id: 'EMBEDDING' as const,
      background: true,
      queued: 12,
      running: 0,
      failed: 0,
      completed: 8,
      approval: 0,
      waiting: [{ reason: 'SCHEDULE' as const, count: 12, nextAt: '2026-10-24T15:00:00Z' }],
      steps: [
        { id: 'GENERATE_EMBEDDING', queued: 12, running: 0, failed: 0, completed: 8, approval: 0 },
      ],
    },
  ],
};
function mount(props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL">
        <EagleTaskCenter {...props} />
      </LibraryWorkspaceProvider>
    </QueryClientProvider>,
  );
}
describe('unified task center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue(summary);
    vi.mocked(api.updateEagleTaskSchedule).mockResolvedValue(summary.settings);
  });
  it('explains dependencies, computation and the actual schedule in compact rows', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    const card = within(screen.getByRole('article'));
    expect(card.getByText('预览图 + Mac 2B 模型')).toBeVisible();
    expect(card.getByText('Mac · 较重')).toBeVisible();
    expect(card.getByText('23:00–06:00')).toBeVisible();
    expect(screen.queryByText('按后台安排执行')).not.toBeInTheDocument();
    expect(screen.queryByText('自动维护')).not.toBeInTheDocument();
  });
  it('shows a family pause instead of the global processing window', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, policy: { paused: true, priority: 0 } }],
    });
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    expect(within(screen.getByRole('article')).getByText('已暂停')).toBeVisible();
  });
  it.each([
    ['ALWAYS', '随时'],
    ['MANUAL', '已暂停'],
  ])('shows the saved %s schedule without inventing a time window', async (mode, label) => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      settings: { ...summary.settings, mode },
    });
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    expect(within(screen.getByRole('article')).getByText(label)).toBeVisible();
  });
  it('explains location-triggered updates even while scheduled analysis is paused', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      settings: { ...summary.settings, mode: 'MANUAL' },
      groups: [{ ...summary.groups[0]!, id: 'PHOTO_MAP', background: false }],
    });
    mount();
    await screen.findByRole('heading', { name: '照片位置索引' });
    expect(within(screen.getByRole('article')).getByText('位置变化后分批更新')).toBeVisible();
  });
  it('shows remaining work including failures and keeps completed counts in details', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, running: 1, failed: 2 }],
    });
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    const card = within(screen.getByRole('article'));
    expect(card.getByText('剩余 15 项')).toBeVisible();
    expect(card.queryByText('已完成 8')).not.toBeInTheDocument();
  });
  it('shows ready when all work is completed instead of a historical completion count', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, queued: 0, waiting: [] }],
    });
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    expect(within(screen.getByRole('article')).getByText('已就绪')).toBeVisible();
  });
  it('groups work by purpose and explains waits before exposing technical steps', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '2B 向量搜图' })).toBeVisible();
    expect(screen.getByText(/等待运行时段/)).toBeVisible();
    expect(screen.getByText('生成图片向量')).not.toBeVisible();
    fireEvent.click(screen.getByText('查看处理步骤'));
    expect(screen.getByText('生成图片向量')).toBeVisible();
    expect(screen.getByText(/独立封面维护/)).toBeVisible();
  });
  it('lets an ordinary owner pause background work while explaining essential work continues', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.change(screen.getByRole('combobox', { name: '后台运行方式' }), {
      target: { value: 'MANUAL' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存安排' }));
    await waitFor(() =>
      expect(api.updateEagleTaskSchedule).toHaveBeenCalledWith({
        mode: 'MANUAL',
        nightStart: '23:00',
        nightEnd: '06:00',
      }),
    );
    expect(screen.getByText(/基础浏览、地图索引和必要清理继续运行/)).toBeVisible();
  });
  it('retains unsaved schedule edits when live status refreshes and offers retry after an error', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockRejectedValueOnce(new Error('读取失败'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(api.fetchEagleTaskCenter).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('开始时间')).toHaveValue('22:00');
  });
  it('pauses one work category and can prioritize it without changing the global schedule', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.click(screen.getByRole('button', { name: '暂停这项工作' }));
    await waitFor(() =>
      expect(api.updateEagleTaskPolicy).toHaveBeenCalledWith({
        family: 'EMBEDDING',
        paused: true,
        priority: 0,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('处理顺序')).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('处理顺序'), { target: { value: '1' } });
    await waitFor(() =>
      expect(api.updateEagleTaskPolicy).toHaveBeenLastCalledWith({
        family: 'EMBEDDING',
        paused: false,
        priority: 1,
      }),
    );
    expect(api.updateEagleTaskSchedule).not.toHaveBeenCalled();
  });
  it('routes approvals to human review and keeps detailed controls in the same center', async () => {
    const onReview = vi.fn();
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, id: 'APPROVALS', background: false, approval: 1 }],
    });
    mount({ onReview, canManageProcessing: true });
    fireEvent.click(await screen.findByRole('button', { name: '去审批' }));
    expect(onReview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '查看详细处理记录' }));
    expect(screen.getByText('处理记录详情')).toBeVisible();
  });
  it('retries a failed category and offers resume without confusing it with the global schedule', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      worker: 'OFFLINE',
      groups: [
        { ...summary.groups[0]!, failed: 2, running: 1, policy: { paused: true, priority: 1 } },
      ],
    });
    vi.mocked(api.retryEagleTaskFamily).mockResolvedValue({ retried: 2 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '重试失败任务' }));
    await waitFor(() => expect(api.retryEagleTaskFamily).toHaveBeenCalledWith('EMBEDDING'));
    await screen.findByText('失败任务已重新排队');
    fireEvent.click(screen.getByRole('button', { name: '继续这项工作' }));
    await waitFor(() =>
      expect(api.updateEagleTaskPolicy).toHaveBeenCalledWith({
        family: 'EMBEDDING',
        paused: false,
        priority: 1,
      }),
    );
    expect(screen.getByText('处理服务离线')).toBeVisible();
  });
  it('shows an empty library without inventing active tasks, and exposes save failures', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({ ...summary, groups: [] });
    vi.mocked(api.updateEagleTaskSchedule).mockRejectedValueOnce(new Error('保存失败'));
    mount();
    await screen.findByText('暂时没有后台工作。新任务会自动出现在这里。');
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '07:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存安排' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  });
});
