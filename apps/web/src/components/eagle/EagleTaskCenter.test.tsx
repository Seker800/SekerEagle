import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import * as api from '../../lib/eagle-task-center-api';
import { EagleTaskCenter } from './EagleTaskCenter';

const operationList = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: () => ({ list: operationList }),
}));
vi.mock('../../lib/eagle-task-center-api', () => ({
  fetchEagleTaskCenter: vi.fn(),
  updateEagleTaskSchedule: vi.fn(),
  retryEagleTaskFamily: vi.fn(),
  startEagleTaskFamily: vi.fn(),
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
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue(summary);
  vi.mocked(api.updateEagleTaskSchedule).mockResolvedValue(summary.settings);
  vi.mocked(api.createEagleTaskCenterApi).mockReturnValue({
    fetchEagleTaskCenter: vi.fn().mockResolvedValue({ ...summary, groups: [] }),
    updateEagleTaskSchedule: vi.fn().mockResolvedValue(summary.settings),
    updateEagleTaskPolicy: vi.fn(),
    retryEagleTaskFamily: vi.fn(),
    startEagleTaskFamily: vi.fn(),
  });
});
describe('unified task center', () => {
  it('keeps one status and remaining count visible while technical facts stay collapsed', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    const card = within(screen.getByRole('article'));
    expect(card.getByText('预览图 + Mac 2B 模型')).not.toBeVisible();
    expect(card.getByText('Mac · 较重')).not.toBeVisible();
    expect(card.getByText('排队ing')).toBeVisible();
    expect(card.getByText('剩余 12 项')).toBeVisible();
    expect(card.queryByText('计算图片向量，用于文字和相似图搜索。')).not.toBeInTheDocument();
    fireEvent.click(card.getByText('查看处理步骤'));
    expect(card.getByText('预览图 + Mac 2B 模型')).toBeVisible();
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
    const card = within(screen.getByRole('article'));
    if (mode === 'ALWAYS') fireEvent.click(card.getByText('查看处理步骤'));
    expect(card.getByText(label)).toBeVisible();
  });
  it('explains location-triggered updates even while scheduled analysis is paused', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      settings: { ...summary.settings, mode: 'MANUAL' },
      groups: [{ ...summary.groups[0]!, id: 'PHOTO_MAP', background: false }],
    });
    mount();
    await screen.findByRole('heading', { name: '照片位置索引' });
    const card = within(screen.getByRole('article'));
    fireEvent.click(card.getByText('查看处理步骤'));
    expect(card.getByText('位置变化后分批更新')).toBeVisible();
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
  it('shows completion once without a second ready label', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, queued: 0, waiting: [] }],
    });
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    expect(within(screen.getByRole('article')).getByText('已完成')).toBeVisible();
    expect(within(screen.getByRole('article')).queryByText('已就绪')).not.toBeInTheDocument();
  });
  it('groups work by purpose and explains waits before exposing technical steps', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: '任务中心' })).toBeVisible();
    expect(await screen.findByRole('heading', { name: '2B 向量搜图' })).toBeVisible();
    expect(screen.getByText(/等待运行时段/, { selector: 'span' })).toBeVisible();
    expect(screen.getByText('生成图片向量')).not.toBeVisible();
    fireEvent.click(screen.getByText('查看处理步骤'));
    expect(screen.getByText('生成图片向量')).toBeVisible();
    expect(screen.getByText(/独立封面维护/)).toBeVisible();
  });
  it('lets an ordinary owner pause background work while explaining essential work continues', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.change(screen.getByRole('combobox', { name: '全部图库的后台运行方式' }), {
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
    const previousOperationReads = operationList.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(api.fetchEagleTaskCenter).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(operationList.mock.calls.length).toBeGreaterThan(previousOperationReads),
    );
    expect(screen.getByLabelText('开始时间')).toHaveValue('22:00');
  });
  it('pauses one category without exposing or sending a manual priority', async () => {
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.click(screen.getByRole('button', { name: '暂停这项工作' }));
    await waitFor(() =>
      expect(api.updateEagleTaskPolicy).toHaveBeenCalledWith({ family: 'EMBEDDING', paused: true }),
    );
    expect(screen.queryByLabelText('处理顺序')).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('部分安排未保存');
  });
});

describe('execution sections', () => {
  it('shows three ordered sections, keeps disabled failures paused, and removes manual priority', async () => {
    vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [
        summary.groups[0]!,
        { ...summary.groups[0]!, id: 'BROWSE', background: false },
        {
          ...summary.groups[0]!,
          id: 'COLOR',
          queued: 0,
          failed: 6,
          availability: 'DISABLED',
          waiting: [],
        },
      ],
    });
    mount();
    const immediate = await screen.findByRole('region', { name: '立即处理' });
    const scheduled = screen.getByRole('region', { name: '按时段处理' });
    const paused = screen.getByRole('region', { name: '已暂停' });
    expect(within(immediate).getByRole('heading', { name: '缩略图与预览' })).toBeVisible();
    expect(within(scheduled).getByRole('heading', { name: '2B 向量搜图' })).toBeVisible();
    expect(within(paused).getByRole('heading', { name: '代表色提取' })).toBeVisible();
    expect(within(paused).getByText('服务器未启用')).toBeVisible();
    expect(within(paused).queryByRole('button', { name: '继续这项工作' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('处理顺序')).not.toBeInTheDocument();
    expect(
      immediate.compareDocumentPosition(scheduled) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      scheduled.compareDocumentPosition(paused) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('cross-library task visibility and controls', () => {
  it('defaults to both libraries and routes a filtered action to its own library', async () => {
    const other = api.createEagleTaskCenterApi('PHOTO');
    vi.mocked(other.fetchEagleTaskCenter).mockResolvedValue({
      ...summary,
      groups: [{ ...summary.groups[0]!, id: 'COLOR', queued: 7, waiting: [] }],
    });
    mount();
    await screen.findByRole('heading', { name: '代表色提取' });
    expect(screen.getByText('剩余 19 项')).toBeVisible();
    expect(within(screen.getAllByRole('article')[0]!).getByText('照片')).toBeVisible();
    fireEvent.change(screen.getByLabelText('查看范围'), { target: { value: 'PHOTO' } });
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '2B 向量搜图' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: '暂停这项工作' }));
    await waitFor(() =>
      expect(other.updateEagleTaskPolicy).toHaveBeenCalledWith({ family: 'COLOR', paused: true }),
    );
    expect(api.updateEagleTaskPolicy).not.toHaveBeenCalled();
  });

  it('saves a shared window to both libraries and reports partial failures without claiming success', async () => {
    const other = api.createEagleTaskCenterApi('PHOTO');
    vi.mocked(other.updateEagleTaskSchedule).mockRejectedValue(new Error('Unavailable'));
    mount();
    await screen.findByRole('heading', { name: '2B 向量搜图' });
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '02:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存安排' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('部分安排未保存');
    expect(api.updateEagleTaskSchedule).toHaveBeenCalledWith({
      mode: 'NIGHT',
      nightStart: '02:00',
      nightEnd: '06:00',
    });
    expect(other.updateEagleTaskSchedule).toHaveBeenCalledWith({
      mode: 'NIGHT',
      nightStart: '02:00',
      nightEnd: '06:00',
    });
    expect(screen.queryByText('后台安排已保存')).not.toBeInTheDocument();
  });

  it('labels partial totals when one library cannot be loaded instead of silently losing its tasks', async () => {
    const other = api.createEagleTaskCenterApi('PHOTO');
    vi.mocked(other.fetchEagleTaskCenter).mockRejectedValue(new Error('Photo library unavailable'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Photo library unavailable');
    expect(screen.getByText('部分图库读取失败，当前合计仅包含已加载的图库。')).toBeVisible();
    expect(screen.getAllByText('剩余 12 项')[0]).toBeVisible();
  });
});

it('shows the active step for a category with several processing stages', async () => {
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...summary,
    groups: [
      {
        ...summary.groups[0],
        id: 'BROWSE',
        background: false,
        running: 1,
        steps: [
          { ...summary.groups[0].steps[0], id: 'GENERATE_PREVIEW', running: 1 },
          { ...summary.groups[0].steps[0], id: 'PROBE_MEDIA', running: 0 },
        ],
      },
    ],
  });
  mount();
  const card = (await screen.findByRole('heading', { name: '缩略图与预览', level: 3 })).closest(
    'article',
  )!;
  expect(within(card).getByText('计算ing')).toBeInTheDocument();
  expect(within(card).getByLabelText('当前执行步骤')).toHaveTextContent('生成预览图');
});

it('explains that external batch import records are not live worker activity', async () => {
  mount();
  expect(
    await screen.findByText(
      'Eagle 批量导入由导入端管理，尚未接入实时状态；历史记录不计入这里的运行任务。',
    ),
  ).toBeInTheDocument();
});

it('does not repeat a single-stage task name as a current step', async () => {
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...summary,
    groups: [
      { ...summary.groups[0], running: 1, steps: [{ ...summary.groups[0].steps[0], running: 1 }] },
    ],
  });
  mount();
  await screen.findByRole('heading', { name: '2B 向量搜图' });
  const card = within(screen.getByRole('article'));
  expect(card.getByText('计算ing')).toBeVisible();
  expect(card.queryByLabelText('当前执行步骤')).not.toBeInTheDocument();
  expect(card.getByText('生成图片向量')).not.toBeVisible();
});

it('keeps disabled work on its card but excludes it from executable queue totals', async () => {
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...summary,
    groups: [
      ...summary.groups,
      {
        id: 'COLOR',
        background: true,
        availability: 'DISABLED',
        queued: 60760,
        running: 0,
        failed: 0,
        completed: 0,
        approval: 0,
        waiting: [],
        steps: [],
      },
    ],
  } as never);
  mount();
  await screen.findByRole('heading', { name: '代表色提取' });
  const overview = document.querySelector('[class*="overview"]')!;
  expect(overview).toHaveTextContent('剩余 12 项');
  expect(overview).not.toHaveTextContent('剩余 60772 项');
  expect(screen.getByText('剩余 60760 项')).toBeVisible();
});

it('warns about a disconnected model while in-flight work is draining and clears after recovery', async () => {
  const offline = {
    ...summary,
    embedding: 'OFFLINE',
    groups: [{ ...summary.groups[0], running: 2, waiting: [] }],
  };
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue(offline as never);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Mac 模型连接中断');
  expect(screen.getByRole('alert')).toHaveTextContent('其他处理继续');
  expect(screen.getByText('等待模型')).toBeVisible();
  expect(screen.queryByText('计算ing')).not.toBeInTheDocument();
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...offline,
    embedding: 'READY',
  } as never);
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('distinguishes model configuration faults from connection loss without exposing a server address', async () => {
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...summary,
    embedding: 'DRIFTED',
  } as never);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Mac 模型配置不匹配');
  expect(screen.getByRole('alert')).not.toHaveTextContent('192.168');
});

it('shows unscanned photo coverage and starts a durable scan in the photo scope', async () => {
  const start = vi.fn().mockResolvedValue({ queued: 1201 });
  vi.mocked(api.createEagleTaskCenterApi).mockReturnValue({
    ...api.createEagleTaskCenterApi('PHOTO'),
    startEagleTaskFamily: start,
    fetchEagleTaskCenter: vi.fn().mockResolvedValue({
      ...summary,
      groups: [
        {
          id: 'FACES',
          background: true,
          unscanned: 1201,
          availability: 'ENABLED',
          queued: 0,
          running: 0,
          failed: 0,
          completed: 0,
          approval: 0,
          waiting: [],
          steps: [],
        },
      ],
    }),
  });
  mount();
  const heading = await screen.findByRole('heading', { name: '人物识别' });
  const card = within(heading.closest('article')!);
  expect(card.getByText('尚未扫描')).toBeVisible();
  expect(card.getByText('未扫描 1201 张')).toBeVisible();
  expect(card.queryByText('已完成')).not.toBeInTheDocument();
  fireEvent.click(card.getByRole('button', { name: '扫描未分析照片' }));
  await waitFor(() => expect(start).toHaveBeenCalledWith('FACES'));
  expect(await screen.findByText('已加入 1201 个本地人脸分析任务')).toBeVisible();
  expect(api.updateEagleTaskPolicy).not.toHaveBeenCalled();
});
it.each(['DISABLED', 'ENABLED'] as const)(
  'keeps disabled models and empty coverage honest: %s',
  async (availability) => {
    vi.mocked(api.createEagleTaskCenterApi).mockReturnValue({
      ...api.createEagleTaskCenterApi('PHOTO'),
      fetchEagleTaskCenter: vi.fn().mockResolvedValue({
        ...summary,
        groups: [
          {
            id: 'FACES',
            background: true,
            unscanned: availability === 'DISABLED' ? 2 : 0,
            availability,
            queued: 0,
            running: 0,
            failed: 0,
            completed: 0,
            approval: 0,
            waiting: [],
            steps: [],
          },
        ],
      }),
    });
    mount();
    const heading = await screen.findByRole('heading', { name: '人物识别' });
    const card = within(heading.closest('article')!);
    if (availability === 'DISABLED')
      expect(card.getByRole('button', { name: '扫描未分析照片' })).toBeDisabled();
    else expect(card.getByText('暂无可扫描照片')).toBeVisible();
    if (availability === 'DISABLED') expect(card.getByText('服务器未启用')).toBeVisible();
    expect(card.queryByText('已完成')).not.toBeInTheDocument();
  },
);

it('allows pausing a completed category before new automatic work arrives', async () => {
  vi.mocked(api.fetchEagleTaskCenter).mockResolvedValue({
    ...summary,
    groups: [{ ...summary.groups[0]!, queued: 0, waiting: [] }],
  });
  mount();
  await screen.findByRole('heading', { name: '2B 向量搜图' });
  fireEvent.click(screen.getByRole('button', { name: '暂停这项工作' }));
  await waitFor(() =>
    expect(api.updateEagleTaskPolicy).toHaveBeenCalledWith({ family: 'EMBEDDING', paused: true }),
  );
});
