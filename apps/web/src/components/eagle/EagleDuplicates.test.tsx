import { act } from '@testing-library/react';
import { ApiError } from '../../lib/api-error';
import { useAssetOperationProgress } from './useAssetOperations';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderInWorkspace } from '../../test/render-in-workspace';
import { EagleDuplicates } from './EagleDuplicates';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  members: vi.fn(),
  scan: vi.fn(),
  cleanup: vi.fn(),
  ignore: vi.fn(),
  operations: [] as Array<{
    id: string;
    libraryMode: string;
    kind: string;
    running: boolean;
    queued: boolean;
    completed: number;
    total: number;
    failed: number;
  }>,
}));
vi.mock('../../lib/eagle-duplicates-api', () => ({ createDuplicatesApi: () => mocks }));
vi.mock('../../lib/asset-operations-api', () => ({
  createAssetOperationsApi: (mode: string) => ({
    list: async () => mocks.operations.filter((row) => row.libraryMode === mode),
    results: async (id: string) => {
      const operation = mocks.operations.find((row) => row.id === id);
      if (!operation) throw new ApiError('操作不存在', 404, null);
      return {
        operation: { cancelled: 0, state: 'COMPLETED', errors: [], ...operation },
        revision: 'v1',
        membership: [],
        receipts: [
          {
            status: operation.completed ? 'COMPLETED' : operation.failed ? 'FAILED' : 'CANCELLED',
            errorCode: null,
            assetIds: ['two'],
            groupSignature: 'a'.repeat(64),
          },
        ],
        nextCursor: null,
      };
    },
  }),
}));
vi.mock('./EagleAssetThumbnail', () => ({ EagleAssetThumbnail: () => <span>图片预览</span> }));
const group = {
  signature: 'a'.repeat(64),
  kind: 'EXACT',
  recommendedId: 'one',
  count: 2,
  removableBytes: 1024,
  previews: [],
};
function render() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Progress() {
    useAssetOperationProgress(false, true);
    return null;
  }
  const show = (open = true) => (
    <QueryClientProvider client={client}>
      <Progress />
      {open && <EagleDuplicates includePrivate={false} onClose={() => {}} />}
    </QueryClientProvider>
  );
  const view = renderInWorkspace(show());
  return {
    ...view,
    client,
    reopen: () => view.rerender(show(true)),
    hide: () => view.rerender(show(false)),
    update: () => {
      client.setQueryData(['eagle', 'owner', 'MATERIAL', 'operations', false], mocks.operations);
      view.rerender(show());
    },
  };
}
describe('duplicate cleanup review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operations = [];
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    mocks.list.mockResolvedValue({
      revision: 'b'.repeat(64),
      exactRevision: 'b'.repeat(64),
      exactItems: 1,
      coverage: { total: 60000, indexed: 100, waiting: 5 },
      totalGroups: 1,
      exactGroups: 1,
      similarGroups: 0,
      ignoredGroups: 0,
      removableBytes: 1024,
      nextCursor: null,
      groups: [group],
    });
    mocks.scan.mockImplementation(async (id: string) => {
      mocks.operations.push({
        id,
        libraryMode: 'MATERIAL',
        kind: 'DUPLICATE_SCAN',
        queued: true,
        running: false,
        completed: 0,
        total: 1,
        failed: 0,
      });
      return { operationId: id };
    });
    mocks.cleanup.mockImplementation(async (input: { operationId: string }) => {
      mocks.operations.push({
        id: input.operationId,
        libraryMode: 'MATERIAL',
        kind: 'DUPLICATE_CLEANUP',
        queued: true,
        running: false,
        completed: 0,
        total: 1,
        failed: 0,
      });
      return { operationId: input.operationId };
    });
  });
  it('shows incomplete indexing honestly and starts a durable incremental scan', async () => {
    render();
    await screen.findByRole('button', { name: '清理全部完全重复项' });
    expect(screen.getByText(/100.*60,000/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '检查新内容' }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
  });
  it('requires a concrete review before cleaning all exact duplicates and keeps the same retry identity', async () => {
    render();
    await screen.findByRole('button', { name: '清理全部完全重复项' });
    fireEvent.click(screen.getByRole('button', { name: '清理全部完全重复项' }));
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(screen.getAllByText(/回收站/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await waitFor(() =>
      expect(mocks.cleanup).toHaveBeenCalledWith(
        expect.objectContaining({
          allExact: true,
          revision: 'b'.repeat(64),
          operationId: expect.any(String),
        }),
      ),
    );
  });
  it('keeps a submitted all-exact cleanup hidden across closing and reopening the review', async () => {
    const view = render();
    fireEvent.click(await screen.findByRole('button', { name: '清理全部完全重复项' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^文件完全相同/ })).not.toBeInTheDocument(),
    );
    view.hide();
    view.reopen();
    await screen.findByRole('button', { name: '清理全部完全重复项' });
    expect(screen.queryByRole('button', { name: /^文件完全相同/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清理全部完全重复项' })).toBeDisabled();
  });
  it('retains an uncertain all-exact intent and confirms the same operation after reopening', async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error('连接中断'));
    const view = render();
    fireEvent.click(await screen.findByRole('button', { name: '清理全部完全重复项' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await screen.findByRole('button', { name: '重试确认' });
    const intent = mocks.cleanup.mock.calls[0][0];
    view.hide();
    view.reopen();
    fireEvent.click(await screen.findByRole('button', { name: '重试确认' }));
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(2));
    expect(mocks.cleanup.mock.calls[1][0]).toEqual(intent);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^文件完全相同/ })).not.toBeInTheDocument(),
    );
  });
  it('reports read failures and permits retry without presenting an empty clean library', async () => {
    mocks.list.mockRejectedValueOnce(new Error('连接失败'));
    render();
    expect(await screen.findByRole('alert')).toHaveTextContent('连接失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByRole('button', { name: /^完全重复/ });
  });
  it('checkboxes consistently mean keep and prohibit removing every copy', async () => {
    mocks.members.mockResolvedValue({
      signature: group.signature,
      recommendedId: 'one',
      kind: 'EXACT',
      total: 2,
      nextCursor: null,
      items: ['one', 'two'].map((id) => ({
        id,
        displayName: id,
        format: 'jpeg',
        width: 1200,
        height: 800,
        byteSize: 1000,
        libraryAddedAt: '2020-01-01',
        rating: null,
        manualTags: [],
        annotation: null,
        renditions: [],
        mediaRevision: 1,
      })),
    });
    render();
    fireEvent.click(await screen.findByRole('button', { name: /^文件完全相同/ }));
    const first = await screen.findByRole('checkbox', { name: '保留 one' });
    expect(first).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '保留 two' })).not.toBeChecked();
    fireEvent.click(first);
    expect(screen.getByText('每组至少保留一项。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留 0 项，清理 2 项' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '保留 two' }));
    fireEvent.click(screen.getByRole('button', { name: '保留 1 项，清理 1 项' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ groups: [{ signature: group.signature, keepIds: ['two'] }] }),
      ),
    );
  });
  it('retries a failed scan with the same command identity', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('检查连接失败'));
    render();
    await screen.findByRole('button', { name: '清理全部完全重复项' });
    fireEvent.click(screen.getByRole('button', { name: '检查新内容' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(2));
    expect(mocks.scan.mock.calls[0]).toEqual(mocks.scan.mock.calls[1]);
  });
  it('a failed cleanup keeps the review and reuses its id on retry', async () => {
    mocks.cleanup.mockRejectedValueOnce(new Error('清理连接失败'));
    render();
    fireEvent.click(await screen.findByRole('button', { name: '清理全部完全重复项' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('清理连接失败');
    fireEvent.click(screen.getByRole('button', { name: '重试确认' }));
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(2));
    expect(mocks.cleanup.mock.calls[0]).toEqual(mocks.cleanup.mock.calls[1]);
  });
  it('visual matches keep unseen members and require explicit removal', async () => {
    const similar = { ...group, kind: 'SIMILAR' as const, count: 3 };
    mocks.list.mockResolvedValue({
      revision: 'b'.repeat(64),
      exactRevision: 'c'.repeat(64),
      exactItems: 0,
      coverage: { total: 3, indexed: 3, waiting: 0 },
      totalGroups: 1,
      exactGroups: 0,
      similarGroups: 1,
      ignoredGroups: 0,
      removableBytes: 2000,
      nextCursor: null,
      groups: [similar],
    });
    mocks.members.mockResolvedValue({
      signature: group.signature,
      recommendedId: 'one',
      kind: 'SIMILAR',
      total: 3,
      nextCursor: '2',
      items: ['one', 'two'].map((id) => ({
        id,
        displayName: id,
        format: 'jpeg',
        width: 1200,
        height: 800,
        byteSize: 1000,
        libraryAddedAt: '2020-01-01',
        rating: null,
        manualTags: [],
        annotation: null,
        renditions: [],
        mediaRevision: 1,
      })),
    });
    render();
    fireEvent.click(await screen.findByRole('button', { name: /^画面近似，待确认/ }));
    expect(await screen.findByRole('checkbox', { name: '保留 one' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '保留 two' })).toBeChecked();
    expect(screen.getByRole('button', { name: '保留 3 项，清理 0 项' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: '保留 two' }));
    fireEvent.click(screen.getByRole('button', { name: '保留 2 项，清理 1 项' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ groups: [{ signature: group.signature, removeIds: ['two'] }] }),
      ),
    );
  });

  it('continues to the next group after submission, prevents repeat submission, and updates completed results automatically', async () => {
    const initial = await mocks.list();
    const next = { ...group, signature: 'd'.repeat(64), previews: [] };
    mocks.list.mockClear();
    mocks.list.mockResolvedValue({
      ...initial,
      totalGroups: 2,
      exactGroups: 2,
      groups: [group, next],
    });
    mocks.members.mockResolvedValue({
      signature: group.signature,
      total: 2,
      nextCursor: null,
      items: ['one', 'two'].map((id) => ({
        id,
        displayName: id,
        format: 'jpeg',
        width: 1200,
        height: 800,
        byteSize: 1000,
        libraryAddedAt: '2020-01-01',
        rating: null,
        manualTags: [],
        annotation: null,
        renditions: [],
        mediaRevision: 1,
      })),
    });
    const view = render();
    fireEvent.click((await screen.findAllByRole('button', { name: /^文件完全相同/ }))[0]);
    await screen.findByRole('checkbox', { name: '保留 one' });
    fireEvent.click(screen.getByRole('button', { name: '保留 1 项，清理 1 项' }));
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^文件完全相同/ })[0]).toHaveAttribute(
        'aria-expanded',
        'true',
      ),
    );
    expect(screen.getAllByRole('button', { name: /^文件完全相同/ })).toHaveLength(1);
    mocks.list.mockResolvedValue({ ...initial, groups: [next] });
    mocks.operations = [
      {
        id: mocks.cleanup.mock.calls[0]![0].operationId,
        libraryMode: 'MATERIAL',
        kind: 'DUPLICATE_CLEANUP',
        running: false,
        queued: false,
        completed: 1,
        total: 1,
        failed: 0,
      },
    ];
    // Preserve an in-progress choice while the operation-poll response rerenders the parent.
    fireEvent.click(screen.getByRole('checkbox', { name: '保留 two' }));
    view.update();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^文件完全相同/ })).toHaveLength(1),
    );
    expect(screen.getByRole('checkbox', { name: '保留 two' })).toBeChecked();
    view.unmount();
  });
  it('keeps a failed single-group choice visible and retries the same command', async () => {
    mocks.cleanup.mockRejectedValueOnce(new ApiError('单组请求失败', 400, null));
    mocks.members.mockResolvedValue({
      signature: group.signature,
      total: 2,
      nextCursor: null,
      items: ['one', 'two'].map((id) => ({
        id,
        displayName: id,
        format: 'jpeg',
        width: 1200,
        height: 800,
        byteSize: 1000,
        libraryAddedAt: '2020-01-01',
        rating: null,
        manualTags: [],
        annotation: null,
        renditions: [],
        mediaRevision: 1,
      })),
    });
    render();
    fireEvent.click(await screen.findByRole('button', { name: /^文件完全相同/ }));
    await screen.findByRole('checkbox', { name: '保留 one' });
    fireEvent.click(screen.getByRole('button', { name: '保留 1 项，清理 1 项' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('单组请求失败');
    expect(screen.getByRole('checkbox', { name: '保留 one' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '保留 1 项，清理 1 项' }));
    await waitFor(() => expect(mocks.cleanup).toHaveBeenCalledTimes(2));
    expect(mocks.cleanup.mock.calls[0]).toEqual(mocks.cleanup.mock.calls[1]);
  });
  it('refreshes even when an accepted scan finishes before its first progress poll', async () => {
    const view = render();
    fireEvent.click(await screen.findByRole('button', { name: '检查新内容' }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledTimes(1));
    mocks.operations = [
      {
        id: mocks.scan.mock.calls[0]![0],
        libraryMode: 'MATERIAL',
        kind: 'DUPLICATE_SCAN',
        running: false,
        queued: false,
        completed: 2,
        total: 2,
        failed: 0,
      },
    ];
    view.update();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
  it('refresh preserves loaded result pages and the current keep selection', async () => {
    const initial = await mocks.list();
    mocks.list.mockClear();
    const next = { ...group, signature: 'e'.repeat(64) };
    mocks.list.mockImplementation((query: { cursor?: string }) =>
      Promise.resolve({
        ...initial,
        groups: [query.cursor ? next : group],
        nextCursor: query.cursor ? null : '24',
      }),
    );
    mocks.members.mockResolvedValue({
      signature: next.signature,
      total: 2,
      nextCursor: null,
      items: ['one', 'two'].map((id) => ({
        id,
        displayName: id,
        format: 'jpeg',
        width: 1200,
        height: 800,
        byteSize: 1000,
        libraryAddedAt: '2020-01-01',
        rating: null,
        manualTags: [],
        annotation: null,
        renditions: [],
        mediaRevision: 1,
      })),
    });
    const view = render();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多组' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^文件完全相同/ })).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^文件完全相同/ })[1]);
    fireEvent.click(await screen.findByRole('checkbox', { name: '保留 two' }));
    await act(async () =>
      view.client.invalidateQueries({ queryKey: ['eagle', 'owner', 'MATERIAL', 'duplicates'] }),
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(4));
    expect(screen.getAllByRole('button', { name: /^文件完全相同/ })).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: '保留 two' })).toBeChecked();
  });
  it('permission revision changes hide old cached names immediately', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mocks.list.mockResolvedValue({
      revision: 'b'.repeat(64),
      exactRevision: 'c'.repeat(64),
      exactItems: 1,
      coverage: { total: 2, indexed: 2, waiting: 0 },
      totalGroups: 1,
      exactGroups: 1,
      similarGroups: 0,
      ignoredGroups: 0,
      removableBytes: 1000,
      nextCursor: null,
      groups: [{ ...group, previews: [{ id: 'old', displayName: 'old-public-name' }] }],
    });
    const show = (scopeRevision: string) => (
      <QueryClientProvider client={client}>
        <EagleDuplicates includePrivate={false} scopeRevision={scopeRevision} onClose={() => {}} />
      </QueryClientProvider>
    );
    const view = renderInWorkspace(show('before'));
    await screen.findByText('old-public-name');
    mocks.list.mockImplementation(() => new Promise(() => {}));
    view.rerender(show('after'));
    expect(screen.queryByText('old-public-name')).not.toBeInTheDocument();
  });
 it('can refresh current results without starting another scan and preserves keep choices',async()=>{
  render();await screen.findByText('1 组待检查');const before=mocks.list.mock.calls.length;
  fireEvent.click(screen.getByRole('button',{name:'刷新结果'}));await waitFor(()=>expect(mocks.list).toHaveBeenCalledTimes(before+1));expect(mocks.scan).not.toHaveBeenCalled();
 });
 it('refreshes results when checking finds an already completed index',async()=>{
  mocks.scan.mockResolvedValue({operationId:null});render();await screen.findByText('1 组待检查');const before=mocks.list.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'检查新内容'}));await waitFor(()=>expect(mocks.list.mock.calls.length).toBeGreaterThan(before));
 });

});
