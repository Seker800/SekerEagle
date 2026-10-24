import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, it, expect, vi } from 'vitest';
import { PhotoAgentReview } from './PhotoAgentReview';
import type { PhotoAgentTask } from '../../lib/photo-agent-api';
const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  undo: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  history: vi.fn(),
}));
vi.mock('../../lib/photo-agent-api', () => ({
  listPhotoAgentTasks: mocks.list,
  getPhotoAgentTask: mocks.detail,
  getPhotoAgentHistory: mocks.history,
  reviewPhotoRequest: mocks.review,
  undoPhotoAgentSuggestion: mocks.undo,
}));
function fixture(): PhotoAgentTask {
  return {
    id: 'task',
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
    suggestions: ['one', 'two'].map((id) => ({
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
  mocks.list.mockResolvedValue({
    items: [
      {
        id: 'task',
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
  const cards = screen.getAllByRole('article');
  expect(
    cards.at(-1)!.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(mocks.review).not.toHaveBeenCalled();
});
