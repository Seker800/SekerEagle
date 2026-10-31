import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AssetOperationSummary } from '@sekereagle/library-core';
import { renderInWorkspace } from '../../test/render-in-workspace';
import { EagleOperationNotices } from './EagleOperationNotices';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  retry: vi.fn(),
  undo: vi.fn(),
  list: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock('../../lib/asset-operations-api', () => ({ createAssetOperationsApi: () => mocks }));
vi.mock('../../lib/eagle-duplicates-api', () => ({ createDuplicatesApi: () => mocks }));
const summary = (patch: Partial<AssetOperationSummary> = {}): AssetOperationSummary => ({
  id: 'delete',
  kind: 'TRASH',
  libraryMode: 'MATERIAL',
  total: 2,
  completed: 1,
  failed: 1,
  queued: 0,
  running: 0,
  cancelled: 0,
  state: 'STOPPED',
  errors: [{ code: 'ASSET_CHANGED', count: 1 }],
  ...patch,
});
function fixture() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const changes = getEagleWorkspaceCache(client, 'owner', 'MATERIAL').operations;
  return {
    client,
    changes,
    show: () =>
      renderInWorkspace(
        <QueryClientProvider client={client}>
          <EagleOperationNotices />
        </QueryClientProvider>,
      ),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.enqueue.mockImplementation(async (input) =>
    summary({ id: input.operationId, queued: 1, completed: 0, failed: 0, errors: [] }),
  );
});
it('dismissing a notice leaves the pending deletion and hidden card intact', () => {
  const f = fixture();
  f.changes.begin('delete', 'TRASH', ['a']);
  f.show();
  expect(screen.getByText('正在处理 0 / 1 项')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '关闭操作提示' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(f.changes.hasPending()).toBe(true);
  expect(f.changes.visible('a', false)).toBe(false);
  f.client.clear();
});
it('retries only failed request IDs and never the successfully deleted member or projected companion', async () => {
  const f = fixture();
  f.changes.begin('delete', 'TRASH', ['a', 'b']);
  f.changes.expand('delete', ['motion']);
  f.changes.finish(
    'delete',
    'TRASH',
    [
      { assetIds: ['a'], status: 'COMPLETED', errorCode: null },
      { assetIds: ['b', 'motion'], status: 'FAILED', errorCode: 'ASSET_CHANGED' },
    ],
    summary(),
  );
  f.show();
  expect(screen.getByRole('alert')).toHaveTextContent('已完成 1 项，1 项未完成');
  fireEvent.click(screen.getByRole('button', { name: '重试未完成项' }));
  await waitFor(() =>
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'TRASH', assetIds: ['b'] }),
    ),
  );
  f.client.clear();
});
it('confirms an uncertain cleanup through its original endpoint with the same durable intent', async () => {
  const f = fixture();
  const input = { operationId: 'cleanup', allExact: true, revision: 'revision' };
  f.changes.begin('cleanup', 'DUPLICATE_CLEANUP', []);
  f.changes.setDuplicateInput('cleanup', input);
  f.changes.uncertain('cleanup', '连接中断');
  mocks.cleanup.mockResolvedValue({ operationId: 'cleanup' });
  mocks.list.mockResolvedValue([
    summary({
      id: 'cleanup',
      kind: 'DUPLICATE_CLEANUP',
      queued: 2,
      failed: 0,
      completed: 0,
      errors: [],
    }),
  ]);
  f.show();
  fireEvent.click(screen.getByRole('button', { name: '重试确认' }));
  await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledWith(input));
  expect(mocks.enqueue).not.toHaveBeenCalled();
  await waitFor(() => expect(f.changes.entries[0]?.uncertain).toBe(false));
  f.client.clear();
});
it('persists a successful undo acknowledgment and exposes its restore task', async () => {
  const f = fixture();
  f.changes.begin('delete', 'TRASH', ['a']);
  mocks.undo.mockResolvedValue(
    summary({
      id: 'undo',
      undoOf: 'delete',
      kind: 'RESTORE',
      queued: 1,
      completed: 0,
      failed: 0,
      errors: [],
    }),
  );
  f.show();
  fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
  await waitFor(() => expect(mocks.undo).toHaveBeenCalledWith('delete', expect.any(String)));
  await waitFor(() =>
    expect(f.changes.entries.find((row) => row.id === 'delete')?.undoId).toBe('undo'),
  );
  expect(f.changes.entries.find((row) => row.id === 'undo')?.pending).toBe(true);
  f.client.clear();
});
it('auto-dismisses successful completion but retains a definitive error without resource IDs', () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.changes.begin('delete', 'TRASH', ['a']);
    f.changes.finish(
      'delete',
      'TRASH',
      [],
      summary({ total: 1, completed: 1, failed: 0, errors: [] }),
    );
    f.changes.begin('rejected', 'DUPLICATE_CLEANUP', []);
    f.changes.reject('rejected', '请重新检查');
    f.show();
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.queryByText('已完成 1 项，0 项未完成')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('请重新检查');
    f.client.clear();
  } finally {
    vi.useRealTimers();
  }
});

it('reports cancelled and skipped work separately from successful deletion', () => {
  const f = fixture();
  f.changes.begin('delete', 'TRASH', ['a', 'b']);
  f.changes.finish(
    'delete',
    'TRASH',
    [],
    summary({ total: 2, completed: 1, skipped: 1, cancelled: 1, failed: 0, errors: [] }),
  );
  f.show();
  expect(screen.getByText('已完成 0 项，0 项未完成')).toBeInTheDocument();
  expect(screen.getByText('已取消 1 项')).toBeInTheDocument();
  expect(screen.getByText('已跳过 1 项已移除的内容')).toBeInTheDocument();
  expect(f.changes.visible('a', false)).toBe(true);
  f.client.clear();
});
