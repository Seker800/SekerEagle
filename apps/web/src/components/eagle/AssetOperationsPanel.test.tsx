import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssetOperationSummary } from '@sekereagle/library-core';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { AssetOperationsPanel } from './AssetOperationsPanel';
import { useAssetOperationProgress } from './useAssetOperations';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  results: vi.fn(),
}));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: (mode: string) => ({
    list: (visible: boolean) => mocks.list(mode, visible),
    retry: (id: string) => mocks.retry(mode, id),
    cancel: (id: string) => mocks.cancel(mode, id),
    results: (id: string) => mocks.results(mode, id),
  }),
}));
const job = (changes: Partial<AssetOperationSummary> = {}): AssetOperationSummary => ({
  id: 'send',
  kind: 'SEND',
  libraryMode: 'PHOTO',
  total: 10,
  completed: 2,
  queued: 7,
  running: 1,
  failed: 0,
  cancelled: 0,
  state: 'RUNNING',
  errors: [],
  ...changes,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockImplementation(async (mode) => (mode === 'PHOTO' ? [job()] : []));
  mocks.cancel.mockResolvedValue({});
  mocks.retry.mockResolvedValue({});
});
function show(
  scope: 'ALL' | 'PHOTO' | 'MATERIAL' = 'ALL',
  includePrivate = true,
  progressOnly = false,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Progress() {
    useAssetOperationProgress(includePrivate, true);
    return null;
  }
  render(
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode="PHOTO">
        {progressOnly ? (
          <Progress />
        ) : (
          <AssetOperationsPanel scope={scope} includePrivate={includePrivate} />
        )}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>,
  );
  return client;
}
it('shows useful progress, scopes private visibility to the active mode and cancels only through its API', async () => {
  show();
  const card = within(await screen.findByRole('article'));
  expect(card.getByRole('heading', { name: '发送到素材' })).toBeVisible();
  expect(card.getByText('发送中…')).toBeVisible();
  expect(card.getByText('已完成 2 / 10 项')).toBeVisible();
  expect(mocks.list).toHaveBeenCalledWith('PHOTO', true);
  expect(mocks.list).toHaveBeenCalledWith('MATERIAL', false);
  fireEvent.click(card.getByRole('button', { name: '停止排队' }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('PHOTO', 'send'));
});
it('keeps completed history folded, retries only failures and hides other scopes', async () => {
  mocks.list.mockImplementation(async (mode) =>
    mode === 'PHOTO'
      ? [
          job({
            id: 'failed',
            kind: 'TRASH',
            total: 2,
            completed: 0,
            state: 'STOPPED',
            failed: 2,
            queued: 0,
            running: 0,
            errors: [{ code: 'ASSET_CHANGED', count: 2 }],
          }),
          job({
            id: 'done',
            kind: 'RESTORE',
            state: 'COMPLETED',
            completed: 10,
            queued: 0,
            running: 0,
          }),
        ]
      : [job({ id: 'other', libraryMode: 'MATERIAL' })],
  );
  show('PHOTO');
  expect(await screen.findByText('已停止（2项失败）')).toBeVisible();
  expect(screen.queryByRole('heading', { name: '发送到照片' })).not.toBeInTheDocument();
  expect(screen.getByText('资源已改变，请重新选择。', { exact: false })).not.toBeVisible();
  fireEvent.click(screen.getByText('查看失败原因'));
  expect(screen.getByText('资源已改变，请重新选择。', { exact: false })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '重试失败任务' }));
  await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('PHOTO', 'failed'));
  expect(screen.getByRole('heading', { name: '恢复', hidden: true })).not.toBeVisible();
  fireEvent.click(screen.getByText('操作记录', { exact: false }));
  expect(screen.getByRole('heading', { name: '恢复' })).toBeVisible();
});
it('reports request failure without presenting the command as completed', async () => {
  mocks.cancel.mockRejectedValue(Error('synthetic network failure'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '停止排队' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('操作失败，请重试。');
  expect(screen.getByText('发送中…')).toBeVisible();
});
it('reconciles terminal send receipts in both modes and never refetches the polling queries', async () => {
  const client = show('ALL', false, true);
  await waitFor(() =>
    expect(client.getQueryData(['eagle', 'owner', 'PHOTO', 'operations', false])).toBeDefined(),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  client.setQueryData(['eagle', 'owner', 'PHOTO', 'operations', false], [job({ completed: 3 })]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(invalidate).not.toHaveBeenCalled();
  const terminal = job({ completed: 3, queued: 0, running: 0, failed: 7, state: 'STOPPED' });
  mocks.results.mockResolvedValue({
    operation: terminal,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  client.setQueryData(['eagle', 'owner', 'PHOTO', 'operations', false], [terminal]);
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  for (const mode of ['MATERIAL', 'PHOTO']) {
    const predicates = invalidate.mock.calls.map(([filters]) => filters!.predicate!);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'owner', mode, 'manual-tags'], state: {} } as never),
      ),
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'owner', mode, 'operations'], state: {} } as never),
      ),
    ).toBe(false);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'other', mode, 'manual-tags'], state: {} } as never),
      ),
    ).toBe(false);
  }
});

it('trash completion calibrates counters once without fetching infinite asset pages', async () => {
  mocks.list.mockImplementation(async (mode) => (mode === 'PHOTO' ? [job({ kind: 'TRASH' })] : []));
  const client = show('ALL', false, true);
  await waitFor(() =>
    expect(client.getQueryData(['eagle', 'owner', 'PHOTO', 'operations', false])).toBeDefined(),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const terminal = job({
    kind: 'TRASH',
    completed: 4,
    queued: 0,
    running: 0,
    failed: 6,
    state: 'STOPPED',
  });
  mocks.results.mockResolvedValue({
    operation: terminal,
    revision: 'v1',
    membership: [],
    receipts: [],
    nextCursor: null,
  });
  client.setQueryData(['eagle', 'owner', 'PHOTO', 'operations', false], [terminal]);
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  const predicate = invalidate.mock.calls[0]![0]!.predicate!;
  expect(
    predicate({
      queryKey: ['eagle', 'owner', 'PHOTO', 'assets', 'ACTIVE', {}],
      state: { data: { pages: [] } },
    } as never),
  ).toBe(false);
  expect(
    predicate({
      queryKey: ['eagle', 'owner', 'PHOTO', 'assets', 'library-count', false, 0],
      state: {},
    } as never),
  ).toBe(true);
});

it('reports partial completion when unavailable items did not block the valid deletion', async () => {
  mocks.list.mockImplementation(async (mode) =>
    mode === 'PHOTO'
      ? [
          job({
            kind: 'TRASH',
            total: 3,
            completed: 2,
            skipped: 1,
            failed: 1,
            queued: 0,
            running: 0,
            state: 'STOPPED',
            errors: [{ code: 'NOT_FOUND', count: 1 }],
          }),
        ]
      : [],
  );
  show('PHOTO');
  expect(await screen.findByText('已部分完成（1项失败）')).toBeVisible();
  expect(screen.getByText('已完成 2 / 3 项')).toBeVisible();
  expect(screen.getByText('已跳过 1 项已移除的内容')).toBeVisible();
  expect(screen.queryByText('已停止（1项失败）')).not.toBeInTheDocument();
});

it('shows an actionable transaction timeout instead of an undiagnosed operation failure', async () => {
  mocks.list.mockImplementation(async (mode) =>
    mode === 'PHOTO'
      ? [
          job({
            state: 'STOPPED',
            failed: 1,
            running: 0,
            queued: 0,
            errors: [{ code: 'TRANSACTION_TIMEOUT', count: 1 }],
          }),
        ]
      : [],
  );
  show();
  fireEvent.click(await screen.findByText('查看失败原因'));
  expect(await screen.findByText(/数据库事务等待超时，未提交的项目可以重试。/)).toBeVisible();
});
