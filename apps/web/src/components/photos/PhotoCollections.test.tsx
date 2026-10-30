import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import { PhotoPrivatePeopleSettings } from './PhotoPrivatePeopleSettings';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  faces: vi.fn(),
  privacy: vi.fn(),
  rename: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  listPhotoPersonFaces: mocks.faces,
  reviewPhotoPeople: vi.fn().mockResolvedValue({ pairs: [] }),
  getPhotoPeopleSummary: vi.fn(async () => ({ named: 1, unnamed: 0 })),
  getPhotoPeopleReview: vi.fn(async () => ({ items: [], nextCursor: null })),
  decidePhotoPeople: vi.fn(),
  updatePhotoPersonPrivacy: mocks.privacy,
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: mocks.rename,
  mergePhotoPeople: vi.fn(),
  splitPhotoFace: vi.fn(),
}));
vi.mock('../../lib/media-resolver', () => ({
  getDesktopCacheBridge: () => ({ clearCache: mocks.clear }),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ ownerId: 'owner', api: {} }),
}));
function wrapper(
  node: React.ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [
      { id: 'person', name: '测试人物', rowVersion: 3, marksAssetsPrivate: false, faces: [] },
    ],
  });
  mocks.faces.mockResolvedValue({ faces: [], nextCursor: null });
  mocks.privacy.mockResolvedValue({});
  mocks.clear.mockResolvedValue(undefined);
});
it('人物私密写入当前版本，清除缓存并刷新整个隐私范围', async () => {
  const changed = vi.fn();
  wrapper(
    <PhotoCollections
      includePrivate={false}
      onPrivacyRulesChange={changed}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '测试人物' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '包含此人的照片设为私密' }));
  await waitFor(() =>
    expect(mocks.privacy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'person', rowVersion: 3 }),
      true,
    ),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(await screen.findByText('已设为私密，开启显示隐私内容后可管理。')).toBeInTheDocument();
});
it('写入失败不伪造成功，并允许重试', async () => {
  mocks.privacy.mockRejectedValueOnce(new Error('人物已变化'));
  const changed = vi.fn();
  wrapper(
    <PhotoCollections
      includePrivate
      onPrivacyRulesChange={changed}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '测试人物' }));
  fireEvent.click(screen.getByRole('checkbox'));
  expect(await screen.findByRole('alert')).toHaveTextContent('人物已变化');
  expect(changed).not.toHaveBeenCalled();
});
it('关闭隐私显示时不读取私密人物设置，开启后可解除规则', async () => {
  const changed = vi.fn();
  const view = wrapper(
    <PhotoPrivatePeopleSettings includePrivate={false} onRulesChange={changed} />,
  );
  expect(mocks.list).not.toHaveBeenCalled();
  expect(screen.getByText('开启显示隐私内容后，可在这里解除私密人物规则。')).toBeInTheDocument();
  view.unmount();
  mocks.list.mockResolvedValue({
    people: [
      { id: 'person', name: '测试人物', rowVersion: 4, marksAssetsPrivate: true, faces: [] },
    ],
  });
  wrapper(<PhotoPrivatePeopleSettings includePrivate onRulesChange={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: '解除人物私密' }));
  await waitFor(() =>
    expect(mocks.privacy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'person', rowVersion: 4 }),
      false,
    ),
  );
  expect(changed).toHaveBeenCalledOnce();
});

it('人物改名后使旧的照片私密原因缓存失效', async () => {
  const client = new QueryClient();
  const key = ['eagle', 'owner', 'PHOTO', 'asset-detail', 'photo'];
  client.setQueryData(key, {
    privacyReasons: [{ kind: 'PERSON', id: 'person', name: '测试人物' }],
  });
  mocks.rename.mockResolvedValue({});
  wrapper(
    <PhotoCollections
      includePrivate
      onPrivacyRulesChange={vi.fn()}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
    client,
  );
  fireEvent.click(await screen.findByRole('button', { name: '测试人物' }));
  fireEvent.change(screen.getByLabelText('人物名称'), { target: { value: '新名字' } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.rename).toHaveBeenCalledWith('person', '新名字'));
  await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
});

it('人物目录可以加载第二页且保留第一页', async () => {
  mocks.list.mockImplementation(async (after?: string) => ({
    runtimeConfigured: true,
    nextCursor: after ? null : 'person',
    people: [
      {
        id: after ? 'person-201' : 'person',
        name: after ? '第二页人物' : '测试人物',
        rowVersion: 1,
        marksAssetsPrivate: false,
        faces: [],
      },
    ],
  }));
  wrapper(
    <PhotoCollections
      includePrivate
      onPrivacyRulesChange={vi.fn()}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '加载更多人物' }));
  expect(await screen.findByRole('button', { name: '第二页人物' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试人物' })).toBeInTheDocument();
});

it('翻到第二页后停止周期性重拉整个目录', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    mocks.list.mockImplementation(async (after?: string) => ({
      runtimeConfigured: true,
      nextCursor: after ? null : 'person',
      people: [
        {
          id: after ? 'second' : 'person',
          name: after ? '第二页人物' : '测试人物',
          rowVersion: 1,
          marksAssetsPrivate: false,
          faces: [],
        },
      ],
    }));
    wrapper(
      <PhotoCollections
        includePrivate
        onPrivacyRulesChange={vi.fn()}
        onOpen={vi.fn()}
        onPerson={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '加载更多人物' }));
    await screen.findByRole('button', { name: '第二页人物' });
    const calls = mocks.list.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(mocks.list).toHaveBeenCalledTimes(calls);
  } finally {
    vi.useRealTimers();
  }
});

it('loads face detail only after selecting a person', async () => {
  wrapper(
    <PhotoCollections
      includePrivate={false}
      onPrivacyRulesChange={vi.fn()}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  const person = await screen.findByRole('button', { name: '测试人物' });
  expect(mocks.faces).not.toHaveBeenCalled();
  fireEvent.click(person);
  await waitFor(() =>
    expect(mocks.faces).toHaveBeenCalledWith('person', undefined, expect.any(AbortSignal)),
  );
});
