import { renderInPhotoWorkspace as render } from '../../test/render-in-workspace';
import { act, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, it, expect, vi } from 'vitest';
import { PhotoAgentReview } from './PhotoAgentReview';
import type { PhotoAgentTask } from '../../lib/photo-agent-api';
const mocks = vi.hoisted(() => ({
  manual: vi.fn(),
  review: vi.fn(),
  undo: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  history: vi.fn(),
  instructions: vi.fn(),
  saveInstructions: vi.fn(),
}));
vi.mock('../../lib/photo-agent-api', () => ({
  listPhotoAgentTasks: mocks.list,
  getPhotoAgentTask: mocks.detail,
  getPhotoAgentHistory: mocks.history,
  getPhotoAgentInstructions: mocks.instructions,
  savePhotoAgentInstructions: mocks.saveInstructions,
  manualPhotoRequestAction: mocks.manual,
  reviewPhotoRequest: mocks.review,
  undoPhotoAgentSuggestion: mocks.undo,
}));
function fixture(): PhotoAgentTask {
  return {
    id: 'task',
    number: 7,
    kind: 'DELETE',
    status: 'OPEN',
    expiresAt: null,
    title: '示例批量申请',
    rationale: '测试 Agent 提交的批量操作理由',
    assets: ['one', 'two'].map((id) => ({
      id,
      displayName: id,
      originalName: `${id}.jpg`,
      mediaRevision: 1,
      rowVersion: 1,
      deletedAt: null,
      previewId: 'preview',
    })),
    suggestions: ['one', 'two'].map((id, index) => ({
      number: index + 1,
      id,
      assetId: id,
      kind: 'DELETE',
      status: 'PENDING',
      value: { category: 'DELETE' },
      rationale: `测试理由 ${id}`,
      evidence: [{ id }],
    })),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.instructions.mockResolvedValue({ instructions: '', revision: 0, updatedAt: null });
  mocks.saveInstructions.mockResolvedValue({
    instructions: '仅按文件名检查截图',
    revision: 1,
    updatedAt: '2026-10-25T00:00:00Z',
  });
  mocks.list.mockResolvedValue({
    items: [
      {
        id: 'task',
        number: 7,
        kind: 'DELETE',
        status: 'OPEN',
        assetCount: 2,
        pendingCount: 2,
        title: '示例批量申请',
        rationale: '测试 Agent 提交的批量操作理由',
        coverIds: ['one', 'two'],
      },
    ],
    next: null,
  });
  mocks.detail.mockResolvedValue(fixture());
  mocks.history.mockResolvedValue({ items: [], next: null });
  mocks.manual.mockResolvedValue({ affectedAssetCount: 1, action: 'DELETE' });
  mocks.review.mockImplementation(async (_task, ids: string[]) => ({
    succeeded: ids.length,
    failed: 0,
    results: ids.map((id) => ({ id, status: 'ACCEPTED' })),
  }));
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhotoAgentReview includePrivate={false} />
    </QueryClientProvider>,
  );
}
async function open() {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /示例批量申请/ }));
  await screen.findByRole('region', { name: '申请详情' });
}
it('lists grouped requests without creating tasks or applying any operation', async () => {
  mount();
  await screen.findByRole('button', { name: /示例批量申请/ });
  expect(screen.getByText('由 Agent 提议，由你决定')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '创建整理任务' })).not.toBeInTheDocument();
  expect(mocks.review).not.toHaveBeenCalled();
});
it('defaults to selecting a whole batch but excludes unchecked items from approval', async () => {
  await open();
  expect(screen.getByText('已选 2 / 2 张')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 two' }));
  fireEvent.click(screen.getByRole('button', { name: '同意选中申请' }));
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('task', ['one'], 'ACCEPT'));
  expect(mocks.review).toHaveBeenCalledTimes(1);
});
it('requires an explicit manual click for rejection too, and reports partial failures accurately', async () => {
  mocks.review.mockResolvedValue({
    succeeded: 1,
    failed: 1,
    results: [
      { id: 'one', status: 'REJECTED' },
      { id: 'two', status: 'ERROR', error: '照片版本冲突' },
    ],
  });
  await open();
  expect(mocks.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '拒绝选中申请' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('本次成功 1 项，失败 1 项。');
  expect(screen.getByRole('alert')).toHaveTextContent('照片版本冲突');
  expect(mocks.review).toHaveBeenCalledWith('task', ['one', 'two'], 'REJECT');
});
it('does not automatically retry failed approved sends', async () => {
  const task = fixture();
  task.kind = 'SEND_TO_MATERIAL';
  task.suggestions = task.suggestions.map((item) => ({
    ...item,
    kind: 'SEND_TO_MATERIAL',
    status: 'FAILED',
  }));
  mocks.detail.mockResolvedValue(task);
  await open();
  expect(
    screen.getByText('同意后发送到素材模式，成功的图片不再显示在照片模式中。'),
  ).toBeInTheDocument();
  expect(mocks.review).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '同意选中申请' }));
  await waitFor(() => expect(mocks.review).toHaveBeenCalledWith('task', ['one', 'two'], 'ACCEPT'));
});
it('shows an empty inbox and keeps large requests bounded until explicitly expanded', async () => {
  const task = fixture();
  task.suggestions = Array.from({ length: 30 }, (_, i) => ({
    ...task.suggestions[0],
    id: `suggestion-${i}`,
  }));
  mocks.detail.mockResolvedValue(task);
  await open();
  expect(screen.getAllByRole('checkbox', { name: '选择 one' })).toHaveLength(12);
  expect(screen.getByText('已选 30 / 30 张')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '展开全部 30 张照片' }));
  expect(screen.getAllByRole('checkbox', { name: '选择 one' })).toHaveLength(30);
});
it('shows no pending work when the inbox is empty', async () => {
  mocks.list.mockResolvedValue({ items: [], next: null });
  mount();
  expect(await screen.findByText('这里暂时没有申请')).toBeInTheDocument();
  expect(mocks.review).not.toHaveBeenCalled();
});

it('retains executed and undone records together and viewing history performs no mutation', async () => {
  mocks.history.mockResolvedValue({
    items: [
      {
        id: 'undo-event',
        assetId: 'one',
        actor: 'HUMAN',
        action: 'UNDONE',
        createdAt: '2026-10-24T10:01:00Z',
        details: {},
      },
      {
        id: 'execute-event',
        assetId: 'one',
        actor: 'HUMAN',
        action: 'EXECUTED',
        createdAt: '2026-10-24T10:00:00Z',
        details: {},
      },
    ],
    next: null,
  });
  await open();
  fireEvent.click(screen.getByText('操作记录'));
  expect(await screen.findByText('撤销成功')).toBeInTheDocument();
  expect(screen.getByText('执行成功')).toBeInTheDocument();
  expect(mocks.review).not.toHaveBeenCalled();
  expect(mocks.undo).not.toHaveBeenCalled();
});

it('keeps operation history collapsed below photo cards', async () => {
  await open();
  const history = screen.getByText('操作记录').closest('details')!;
  expect(history.open).toBe(false);
  expect(mocks.history).not.toHaveBeenCalled();
  const cards = screen.getAllByRole('article');
  expect(
    cards.at(-1)!.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(mocks.review).not.toHaveBeenCalled();
});

it('saves owner instructions explicitly without starting scans or approving requests', async () => {
  mount();
  const field = await screen.findByRole('textbox', { name: '整理要求' });
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.change(field, { target: { value: '仅按文件名检查截图' } });
  expect(mocks.saveInstructions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存要求' }));
  await waitFor(() =>
    expect(mocks.saveInstructions).toHaveBeenCalledWith({
      instructions: '仅按文件名检查截图',
      revision: 0,
    }),
  );
  expect(await screen.findByText('整理要求已保存')).toBeInTheDocument();
  expect(mocks.review).not.toHaveBeenCalled();
});
it('labels metadata-only requests and completed transfers without unavailable preview errors', async () => {
  const task = fixture();
  task.kind = 'SEND_TO_MATERIAL';
  task.assets = task.assets.map((a) => ({ ...a, deletedAt: '2026-10-25T00:00:00Z' }));
  task.suggestions = task.suggestions.map((a) => ({
    ...a,
    kind: 'SEND_TO_MATERIAL',
    status: 'ACCEPTED',
    reviewBasis: 'METADATA',
  }));
  mocks.detail.mockResolvedValue(task);
  await open();
  expect(screen.getAllByText('仅文字依据 · 未看图片')).toHaveLength(2);
  expect(screen.getAllByText('已发送到素材')).toHaveLength(2);
  expect(screen.queryByText('预览暂不可用')).not.toBeInTheDocument();
});

it('keeps already loaded thumbnails stable after a successful batch send', async () => {
  const task = fixture();
  task.kind = 'SEND_TO_MATERIAL';
  task.suggestions = task.suggestions.map((item) => ({ ...item, kind: 'SEND_TO_MATERIAL' }));
  mocks.detail.mockResolvedValueOnce(task).mockResolvedValue({
    ...task,
    assets: task.assets.map((a) => ({ ...a, deletedAt: '2026-10-25T00:00:00Z' })),
    suggestions: task.suggestions.map((s) => ({ ...s, status: 'ACCEPTED' })),
  });
  await open();
  const first = screen.getByRole('img', { name: 'one' });
  fireEvent.load(first);
  fireEvent.load(screen.getByRole('img', { name: 'two' }));
  fireEvent.click(screen.getByRole('button', { name: '同意选中申请' }));
  await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('img', { name: 'one' })).toBe(first);
  expect(screen.queryByText('预览暂不可用')).not.toBeInTheDocument();
});

it('shows stable request and photo numbers and right-click targets only the clicked photo unless already selected', async () => {
  await open();
  expect(screen.getByText('建议 7')).toBeInTheDocument();
  expect(screen.getByText('7.1')).toBeInTheDocument();
  expect(screen.getByText('7.2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '全选照片' }));
  fireEvent.contextMenu(screen.getByRole('img', { name: 'one' }), { clientX: 100, clientY: 100 });
  expect(screen.getByRole('menuitem', { name: '发送到素材' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: '移入回收站' }));
  await waitFor(() =>
    expect(mocks.manual).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({
        action: 'DELETE',
        items: [{ suggestionId: 'one', mediaRevision: 1, rowVersion: 1 }],
      }),
    ),
  );
  expect(mocks.review).not.toHaveBeenCalled();
});
it('supports multiselect manual actions independently from accepting the original recommendation', async () => {
  mocks.manual.mockResolvedValue({ affectedAssetCount: 2 });
  await open();
  fireEvent.contextMenu(screen.getByRole('img', { name: 'one' }), { clientX: 100, clientY: 100 });
  fireEvent.click(screen.getByRole('menuitem', { name: '发送到素材' }));
  await waitFor(() =>
    expect(mocks.manual).toHaveBeenCalledWith(
      'task',
      expect.objectContaining({
        action: 'SEND_TO_MATERIAL',
        items: [
          { suggestionId: 'one', mediaRevision: 1, rowVersion: 1 },
          { suggestionId: 'two', mediaRevision: 1, rowVersion: 1 },
        ],
      }),
    ),
  );
  expect(mocks.review).not.toHaveBeenCalled();
});

it('supports single click, modifier multi-select and shift ranges without executing actions', async () => {
  await open();
  fireEvent.click(screen.getByRole('button', { name: '选择照片 7.1' }));
  expect(screen.getByRole('checkbox', { name: '选择 one' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: '选择 two' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '选择照片 7.2' }), { ctrlKey: true });
  expect(screen.getByRole('checkbox', { name: '选择 two' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '选择照片 7.2' }));
  fireEvent.click(screen.getByRole('button', { name: '选择照片 7.1' }), { shiftKey: true });
  expect(screen.getByText('已选 2 / 2 张')).toBeInTheDocument();
  expect(mocks.manual).not.toHaveBeenCalled();
});
it('never automatically retries manual sends and retains the operation identifier for an explicit retry', async () => {
  mocks.manual
    .mockRejectedValueOnce(new Error('发送失败'))
    .mockResolvedValue({ affectedAssetCount: 2, action: 'SEND_TO_MATERIAL' });
  await open();
  fireEvent.contextMenu(screen.getByRole('img', { name: 'one' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '发送到素材' }));
  await screen.findByRole('alert');
  expect(mocks.manual).toHaveBeenCalledTimes(1);
  fireEvent.contextMenu(screen.getByRole('img', { name: 'one' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '发送到素材' }));
  await waitFor(() => expect(mocks.manual).toHaveBeenCalledTimes(2));
  expect(mocks.manual.mock.calls[0][1].operationId).toBe(mocks.manual.mock.calls[1][1].operationId);
});

it('polls the unopened approval inbox once per minute rather than every ten seconds', async () => {
  vi.useFakeTimers();
  const view = mount();
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.list).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_998);
    });
    expect(mocks.list).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});
