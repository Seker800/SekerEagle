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
}));
vi.mock('../../lib/eagle-duplicates-api', () => ({ createDuplicatesApi: () => mocks }));
vi.mock('./useAssetOperations', () => ({
  useAssetOperationList: () => [{ data: [] }, { data: [] }],
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
  return renderInWorkspace(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <EagleDuplicates includePrivate={false} onClose={() => {}} />
    </QueryClientProvider>,
  );
}
describe('duplicate cleanup review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.scan.mockResolvedValue({ operationId: 'scan' });
    mocks.cleanup.mockResolvedValue({ operationId: 'cleanup' });
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
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
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
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
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
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }));
    await waitFor(() =>
      expect(mocks.cleanup).toHaveBeenCalledWith(
        expect.objectContaining({ groups: [{ signature: group.signature, removeIds: ['two'] }] }),
      ),
    );
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
});
