import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssetOperationSummary } from '@sekereagle/library-core';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { AssetOperationsPanel } from './AssetOperationsPanel';
import { useAssetOperationProgress } from './useAssetOperations';
const mocks = vi.hoisted(() => ({ list: vi.fn(), retry: vi.fn(), cancel: vi.fn() }));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: (mode: string) => ({
    list: (visible: boolean) => mocks.list(mode, visible),
    retry: (id: string) => mocks.retry(mode, id),
    cancel: (id: string) => mocks.cancel(mode, id),
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
it('refreshes both libraries only after publication and never invalidates the polling queries themselves', async () => {
  const client = show('ALL', false, true);
  await waitFor(() =>
    expect(client.getQueryData(['eagle', 'owner', 'PHOTO', 'operations', false])).toBeDefined(),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  client.setQueryData(
    ['eagle', 'owner', 'PHOTO', 'operations', false],
    [job({ completed: 2, running: 0, queued: 0, failed: 8 })],
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(invalidate).not.toHaveBeenCalled();
  client.setQueryData(['eagle', 'owner', 'PHOTO', 'operations', false], [job({ completed: 3 })]);
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
  const predicates = invalidate.mock.calls.map(([filters]) => filters!.predicate!);
  for (const mode of ['MATERIAL', 'PHOTO']) {
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'owner', mode, 'assets', 'ALL', {}] } as never),
      ),
    ).toBe(true);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'owner', mode, 'operations'] } as never),
      ),
    ).toBe(false);
    expect(
      predicates.some((predicate) =>
        predicate({ queryKey: ['eagle', 'other', mode, 'assets'] } as never),
      ),
    ).toBe(false);
  }
});

it('trash progress marks its own workspace stale once without starting a foreground refresh', async () => {
  mocks.list.mockImplementation(async (mode) => (mode === 'PHOTO' ? [job({ kind: 'TRASH' })] : []));
  const client = show('ALL', false, true);
  await waitFor(() =>
    expect(client.getQueryData(['eagle', 'owner', 'PHOTO', 'operations', false])).toBeDefined(),
  );
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  client.setQueryData(
    ['eagle', 'owner', 'PHOTO', 'operations', false],
    [job({ kind: 'TRASH', completed: 3 })],
  );
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
  const predicate = invalidate.mock.calls[0]![0]!.predicate!;
  expect(invalidate.mock.calls[0]![0]!.refetchType).toBe('none');
  expect(predicate({ queryKey: ['eagle', 'owner', 'PHOTO', 'assets', 'ALL', {}] } as never)).toBe(
    true,
  );
  expect(
    predicate({
      queryKey: ['eagle', 'owner', 'PHOTO', 'assets', 'library-count', false, 0],
    } as never),
  ).toBe(true);
  for (const key of [
    ['eagle', 'owner', 'MATERIAL', 'assets', 'ALL', {}],
    ['eagle', 'owner', 'PHOTO', 'operations'],
  ])
    expect(predicate({ queryKey: key } as never)).toBe(false);
  client.setQueryData(
    ['eagle', 'owner', 'PHOTO', 'operations', false],
    [job({ kind: 'TRASH', completed: 3, queued: 0, running: 0, failed: 7, state: 'STOPPED' })],
  );
  expect(invalidate).toHaveBeenCalledTimes(1);
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
