import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoPersonMergeSelection } from './PhotoPersonMergeSelection';
import { ApiError } from '../../lib/api-error';
import type { PhotoPerson } from '../../lib/photo-management-api';
const mocks = vi.hoisted(() => ({ options: vi.fn(), merge: vi.fn() }));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeopleOptions: mocks.options,
  mergeSelectedPhotoPeople: mocks.merge,
}));
const selected = [
  { id: 'a', name: null, rowVersion: 1, marksAssetsPrivate: false, faces: [] },
  { id: 'b', name: null, rowVersion: 2, marksAssetsPrivate: false, faces: [] },
] as PhotoPerson[];
const done = {
  id: 'a',
  rowVersion: 3,
  photoCount: 30,
  marksAssetsPrivate: false,
  mergedIds: ['b'],
};
function show(groups = selected) {
  const onMerged = vi.fn(),
    onClear = vi.fn(),
    onPendingChange = vi.fn(),
    onConflict = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <PhotoPersonMergeSelection
        ownerId="owner"
        includePrivate={false}
        scopeRevision="scope"
        selected={groups}
        onMerged={onMerged}
        onClear={onClear}
        onPendingChange={onPendingChange}
        onConflict={onConflict}
      />
    </QueryClientProvider>,
  );
  return { ...view, onMerged, onClear, onPendingChange, onConflict };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.mockResolvedValue({ people: [], nextCursor: null });
  mocks.merge.mockResolvedValue(done);
});
it('does not load target options without a selection', () => {
  show([]);
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('keeps the chosen selected group and submits one atomic request', async () => {
  const v = show();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await waitFor(() => expect(v.onMerged).toHaveBeenCalledWith(done, false));
  expect(mocks.merge).toHaveBeenCalledWith({
    targetId: 'b',
    people: [
      { id: 'a', rowVersion: 1 },
      { id: 'b', rowVersion: 2 },
    ],
  });
  expect(v.onPendingChange.mock.calls).toEqual([[true], [false]]);
});
it('loads further lightweight target pages and handles mixed private merges', async () => {
  mocks.options.mockResolvedValueOnce({ people: [], nextCursor: 'next' }).mockResolvedValueOnce({
    people: [{ id: 'private', name: '家人', rowVersion: 9, marksAssetsPrivate: true }],
    nextCursor: null,
  });
  mocks.merge.mockResolvedValue({ ...done, id: 'private', marksAssetsPrivate: true });
  const v = show([selected[0]]);
  expect(screen.getByRole('button', { name: '合并所选分组' })).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: '加载更多目标人物' }));
  await screen.findByRole('option', { name: '家人' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'private' } });
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await waitFor(() =>
    expect(v.onMerged).toHaveBeenCalledWith(expect.objectContaining({ id: 'private' }), true),
  );
  expect(mocks.options).toHaveBeenLastCalledWith('next', expect.any(AbortSignal), 'NAMED');
});
it('retains choices on a network failure and permits a deliberate retry', async () => {
  mocks.merge.mockRejectedValueOnce(new Error('网络失败'));
  const v = show();
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await screen.findByText('网络失败');
  expect(screen.getByRole('combobox')).toHaveValue('a');
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await waitFor(() => expect(v.onMerged).toHaveBeenCalledTimes(1));
});
it('refreshes conflicting versions and requires a new selection instead of retrying stale data', async () => {
  mocks.merge.mockRejectedValueOnce(new ApiError('版本冲突', 409, null));
  const v = show();
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await screen.findByText('分组已变化，请清除选择后重新选择。');
  await waitFor(() => expect(v.onConflict).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: '合并所选分组' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
  expect(v.onClear).toHaveBeenCalledTimes(1);
});
it('allows retrying failed target options', async () => {
  mocks.options.mockRejectedValueOnce(new Error('加载失败'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '重试' }));
  await waitFor(() => expect(mocks.options).toHaveBeenCalledTimes(2));
});
it('ignores an in-flight result after the scope is unmounted', async () => {
  let finish: (x: typeof done) => void = () => {};
  mocks.merge.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const v = show();
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  expect(screen.getByRole('button', { name: '正在合并…' })).toBeDisabled();
  v.unmount();
  finish(done);
  await Promise.resolve();
  expect(v.onMerged).not.toHaveBeenCalled();
  expect(mocks.merge).toHaveBeenCalledTimes(1);
});
