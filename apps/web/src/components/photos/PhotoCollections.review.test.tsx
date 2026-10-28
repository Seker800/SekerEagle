import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import type { PhotoPerson } from '../../lib/photo-management-api';

const mocks = vi.hoisted(() => ({ list: vi.fn(), merge: vi.fn(), privacy: vi.fn() }));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  mergePhotoPeople: mocks.merge,
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: vi.fn(),
  splitPhotoFace: vi.fn(),
  updatePhotoPersonPrivacy: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    ownerId: 'owner',
    api: {
      getEagleRenditionContentUrl: (asset: string, rendition: string) => `/${asset}/${rendition}`,
    },
  }),
}));
const person = (id: string, name: string | null = null) =>
  ({
    id,
    name,
    rowVersion: 1,
    marksAssetsPrivate: false,
    faces: [
      {
        id: `face-${id}`,
        box: [0.3, 0.2, 0.1, 0.2],
        confidence: 0.99,
        assetId: id,
        asset: {
          id,
          displayName: `照片-${id}`,
          mimeType: 'image/jpeg',
          mediaRevision: 1,
          width: 4000,
          height: 3000,
          renditions: [
            {
              id: 'small',
              kind: 'THUMBNAIL',
              mimeType: 'image/jpeg',
              revision: 1,
              width: 256,
              height: 192,
            },
            {
              id: 'large',
              kind: 'PREVIEW',
              mimeType: 'image/jpeg',
              revision: 1,
              width: 1600,
              height: 1200,
            },
          ],
        },
      },
    ],
  }) as PhotoPerson;
function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PhotoCollections
        includePrivate={false}
        onPrivacyRulesChange={mocks.privacy}
        onOpen={vi.fn()}
        onPerson={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [person('a'), person('b', '小明'), person('c')],
    nextCursor: null,
  });
  mocks.merge.mockResolvedValue({ id: 'b' });
});
it('用大预览呈现人脸，直接比较两个不同人物，不需要选择合并目标', async () => {
  show();
  const review = await screen.findByRole('region', { name: '这两张照片是同一个人吗？' });
  const photos = within(review).getAllByRole('img');
  expect(photos.map((img) => img.getAttribute('src'))).toEqual(['/a/large', '/b/large']);
  fireEvent.click(screen.getByRole('button', { name: '未命名人物 1' }));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '未命名人物 1' }).querySelector('img')).toHaveAttribute(
    'src',
    '/a/large',
  );
});
it('确认后自动合并展示的两个人，保留已有名字并刷新隐私投影', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '是，同一个人' }));
  await waitFor(() => expect(mocks.merge).toHaveBeenCalledWith('a', 'b'));
  await waitFor(() => expect(mocks.privacy).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('status')).toHaveTextContent('人物已合并');
});
it('换一批更新比较对象且不执行合并', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '换一批' }));
  const review = screen.getByRole('region', { name: '这两张照片是同一个人吗？' });
  expect(
    within(review)
      .getAllByRole('img')
      .map((img) => img.getAttribute('src')),
  ).toEqual(['/a/large', '/c/large']);
  expect(mocks.merge).not.toHaveBeenCalled();
});
it('提交时禁止换批和重复确认，失败保留原照片供重试', async () => {
  let reject!: (error: Error) => void;
  mocks.merge.mockReturnValue(
    new Promise((_, no) => {
      reject = no;
    }),
  );
  show();
  const confirm = await screen.findByRole('button', { name: '是，同一个人' });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(screen.getByRole('button', { name: '换一批' })).toBeDisabled();
  expect(mocks.merge).toHaveBeenCalledTimes(1);
  reject(new Error('合并失败'));
  expect(await screen.findByRole('alert')).toHaveTextContent('合并失败');
  expect(confirm).toBeEnabled();
  expect(
    within(screen.getByRole('region', { name: '这两张照片是同一个人吗？' })).getAllByRole('img')[1],
  ).toHaveAttribute('src', '/b/large');
  expect(mocks.privacy).not.toHaveBeenCalled();
});
it('没有两个有照片的人物时不显示合并确认', async () => {
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [person('a'), { ...person('b'), faces: [] }],
    nextCursor: null,
  });
  show();
  await screen.findByRole('button', { name: '未命名人物 1' });
  expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument();
});
it('没有可用预览的人物不参与确认，避免看不到照片时合并', async () => {
  const missing = person('b');
  missing.faces[0]!.asset.renditions = [];
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [person('a'), missing],
    nextCursor: null,
  });
  show();
  await screen.findByRole('button', { name: '未命名人物 1' });
  expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument();
});
it('换批遍历不同组合，比较结束后可以重新开始', async () => {
  show();
  const next = await screen.findByRole('button', { name: '换一批' });
  fireEvent.click(next);
  fireEvent.click(next);
  const review = screen.getByRole('region', { name: '这两张照片是同一个人吗？' });
  expect(
    within(review)
      .getAllByRole('img')
      .map((img) => img.getAttribute('src')),
  ).toEqual(['/b/large', '/c/large']);
  fireEvent.click(next);
  expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新比较' }));
  expect(screen.getByRole('button', { name: '是，同一个人' })).toBeEnabled();
  expect(mocks.merge).not.toHaveBeenCalled();
});
it('合并后必须换一批才显示下一对，快速再点不会误合并其他人', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '是，同一个人' }));
  await waitFor(() => expect(mocks.privacy).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument(),
  );
  expect(mocks.merge).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '换一批' }));
  await waitFor(() => {
    const review = screen.getByRole('region', { name: '这两张照片是同一个人吗？' });
    expect(
      within(review)
        .getAllByRole('img')
        .map((img) => img.getAttribute('src')),
    ).toEqual(['/b/large', '/c/large']);
  });
  fireEvent.click(screen.getByRole('button', { name: '是，同一个人' }));
  await waitFor(() => expect(mocks.merge).toHaveBeenLastCalledWith('c', 'b'));
});
it('两个人均已命名时，确认前明确告知保留哪个名字', async () => {
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [person('a', '小王'), person('b', '王先生')],
    nextCursor: null,
  });
  show();
  expect(await screen.findByText('合并后保留名称：小王')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '是，同一个人' }));
  await waitFor(() => expect(mocks.merge).toHaveBeenCalledWith('b', 'a'));
});
