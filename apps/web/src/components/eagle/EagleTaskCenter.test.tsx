import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import * as api from '../../lib/eagle-task-center-api';
import { EagleTaskCenter } from './EagleTaskCenter';

vi.mock('../../lib/eagle-task-center-api', () => ({ fetchEagleTaskCenter: vi.fn(), updateEagleTaskSchedule: vi.fn(), retryEagleTaskFamily: vi.fn(), createEagleTaskCenterApi: vi.fn() }));
vi.mock('./EagleProcessingPage', () => ({ EagleProcessingPage: () => <div>处理记录详情</div> }));
vi.mock('./EagleAiTagSetupPanel', () => ({ EagleAiTagSetupPanel: () => <div>AI 内容识别设置</div> }));
const summary = {
  worker: 'ONLINE' as const, settings: { mode: 'NIGHT', nightStart: '23:00', nightEnd: '06:00', timeZone: 'Asia/Shanghai' as const }, refreshedAt: '2026-10-24T04:00:00Z',
  groups: [{ id: 'EMBEDDING' as const, background: true, queued: 12, running: 0, failed: 0, completed: 8, approval: 0, waiting: [{ reason: 'SCHEDULE' as const, count: 12, nextAt: '2026-10-24T15:00:00Z' }], steps: [{ id: 'GENERATE_EMBEDDING', queued: 12, running: 0, failed: 0, completed: 8, approval: 0 }] }],
};
function mount(props = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><LibraryWorkspaceProvider ownerId="owner" libraryMode="MATERIAL"><EagleTaskCenter {...props} /></LibraryWorkspaceProvider></QueryClientProvider>);
}
describe('unified task center', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue(summary); vi.mocked(api.updateEagleTaskSchedule).mockResolvedValue(summary.settings); });
  it('groups work by purpose and explains waits before exposing technical steps', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '图片内容搜索' })).toBeVisible();
    expect(screen.getByText('等待运行时段')).toBeVisible();
    expect(screen.getByText('生成图片向量')).not.toBeVisible();
    fireEvent.click(screen.getByText('查看处理步骤'));
    expect(screen.getByText('生成图片向量')).toBeVisible();
    expect(screen.getByText(/独立封面维护/)).toBeVisible();
  });
  it('lets an ordinary owner pause background work while explaining essential work continues', async () => {
    mount(); await screen.findByRole('heading', { name: '图片内容搜索' });
    fireEvent.change(screen.getByRole('combobox', { name: '后台运行方式' }), { target: { value: 'MANUAL' } });
    fireEvent.click(screen.getByRole('button', { name: '保存安排' }));
    await waitFor(() => expect(api.updateEagleTaskSchedule).toHaveBeenCalledWith({ mode: 'MANUAL', nightStart: '23:00', nightEnd: '06:00' }));
    expect(screen.getByText(/基础浏览、地图索引和必要清理继续运行/)).toBeVisible();
  });
  it('retains unsaved schedule edits when live status refreshes and offers retry after an error', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockRejectedValueOnce(new Error('读取失败'));
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await screen.findByRole('heading', { name: '图片内容搜索' });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '22:00' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(api.fetchEagleTaskCenter).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('开始时间')).toHaveValue('22:00');
  });
});
