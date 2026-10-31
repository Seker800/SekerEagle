import { ApiError } from '../../lib/api-error';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import type { PhotoPerson } from '../../lib/photo-management-api';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  suggest: vi.fn(),
  decide: vi.fn(),
  merge: vi.fn(),
  options: vi.fn(),
}));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  listPhotoPeopleOptions: mocks.options,
  listPhotoPersonFaces: vi.fn().mockResolvedValue({ faces: [], nextCursor: null }),
  getPhotoPeopleSummary: mocks.summary,
  getPhotoPeopleReview: mocks.suggest,
  decidePhotoPeople: mocks.decide,
  mergeSelectedPhotoPeople: mocks.merge,
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: vi.fn(),
  splitPhotoFace: vi.fn(),
  updatePhotoPersonPrivacy: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    ownerId: 'owner',
    api: { getEagleRenditionContentUrl: (id: string) => `/${id}` },
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
        box: [0.2, 0.2, 0.3, 0.3],
        confidence: 0.99,
        assetId: id,
        asset: {
          id,
          displayName: id,
          mimeType: 'image/jpeg',
          mediaRevision: 1,
          width: 1600,
          height: 1200,
          renditions: [
            {
              id: 'preview',
              kind: 'PREVIEW',
              variant: 'default',
              revision: 1,
              mimeType: 'image/jpeg',
              width: 1600,
              height: 1200,
            },
          ],
        },
      },
    ],
  }) as PhotoPerson;
const a = person('a'),
  b = person('b', '小明'),
  c = person('c');
const items = [
  { key: 'a:b', first: a, second: b, similarity: 0.7 },
  { key: 'b:c', first: b, second: c, similarity: 0.6 },
];
const show = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <PhotoCollections
        includePrivate={false}
        onPrivacyRulesChange={vi.fn()}
        onOpen={vi.fn()}
        onPerson={vi.fn()}
      />
    </QueryClientProvider>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ runtimeConfigured: true, people: [b], nextCursor: null });
  mocks.summary.mockResolvedValue({ named: 1, unnamed: 3000 });
  mocks.suggest.mockResolvedValue({ items, nextCursor: null });
  mocks.decide.mockResolvedValue({ saved: true });
});

it('keeps named directory as the default and loads review only on demand', async () => {
  show();
  await screen.findByRole('button', { name: '小明' });
  expect(mocks.suggest).not.toHaveBeenCalled();
});
it('shows nine selectable people and moves forward without recomputing prior pages', async () => {
  const persons = Array.from({ length: 13 }, (_, i) => ({
    ...person(`person-${i}`),
    photoCount: 13 - i,
  }));
  mocks.suggest.mockResolvedValue({
    items: persons.slice(1).map((p) => ({
      key: `${persons[0].id}:${p.id}`,
      first: persons[0],
      second: p,
      similarity: 0.8,
    })),
    nextCursor: null,
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(9));
  fireEvent.click(screen.getByRole('button', { name: '下一组' }));
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(4));
  expect(mocks.suggest).toHaveBeenCalledTimes(1);
});
it('merges selected cards in one versioned request and does not wait for a candidate replay', async () => {
  mocks.merge.mockResolvedValue({
    id: 'b',
    rowVersion: 2,
    photoCount: 6,
    marksAssetsPrivate: false,
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择 未命名分组 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 小明' }));
  expect(screen.getByRole('button', { name: '合并所选人物' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '合并所选人物' }));
  await waitFor(() =>
    expect(mocks.merge).toHaveBeenCalledWith({
      targetId: 'b',
      people: [
        { id: 'a', rowVersion: 1 },
        { id: 'b', rowVersion: 1 },
      ],
    }),
  );
  expect(await screen.findByText('人物已合并')).toBeVisible();
  expect(mocks.suggest).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('checkbox', { name: '选择 未命名分组 1' })).not.toBeInTheDocument();
});
it('failed merges preserve selection and can retry without losing the page', async () => {
  mocks.merge.mockRejectedValue(new Error('人物已变化，请重新选择。'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择 未命名分组 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 小明' }));
  fireEvent.click(screen.getByRole('button', { name: '合并所选人物' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('人物已变化');
  expect(screen.getByRole('checkbox', { name: '选择 未命名分组 1' })).toBeChecked();
});
it('automatically traverses empty pages and shows empty only at the end', async () => {
  mocks.suggest.mockImplementation(async (after?: string) =>
    !after ? { items: [], nextCursor: 'next' } : { items, nextCursor: null },
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  await screen.findByRole('checkbox', { name: '选择 未命名分组 1' });
  expect(mocks.suggest).toHaveBeenCalledTimes(2);
});
it('does not invent people in an empty review', async () => {
  mocks.suggest.mockResolvedValue({ items: [], nextCursor: null });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  expect(await screen.findByText('暂时没有需要确认的相似人物。')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('prefetches only one batch ahead even when later pages repeat the same identities', async () => {
  mocks.suggest.mockImplementation(async (after?: string) => ({
    items,
    nextCursor: after ? after + '-next' : 'first',
  }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  await screen.findByRole('checkbox', { name: '选择 未命名分组 1' });
  await waitFor(() => expect(mocks.suggest).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(mocks.suggest).toHaveBeenCalledTimes(2);
});

it('persists different-person answers and uses returned current versions for a later merge', async () => {
  mocks.decide.mockResolvedValue({
    saved: true,
    people: [
      { id: 'a', rowVersion: 2 },
      { id: 'b', rowVersion: 2 },
    ],
  });
  mocks.merge.mockResolvedValue({
    id: 'b',
    rowVersion: 3,
    photoCount: 2,
    marksAssetsPrivate: false,
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  for (const name of ['选择 未命名分组 1', '选择 小明'])
    fireEvent.click(await screen.findByRole('checkbox', { name }));
  fireEvent.click(screen.getByRole('button', { name: '不是同一个人' }));
  await screen.findByText('已记住：不是同一个人。');
  for (const name of ['选择 未命名分组 1', '选择 小明'])
    fireEvent.click(screen.getByRole('checkbox', { name }));
  fireEvent.click(screen.getByRole('button', { name: '合并所选人物' }));
  await waitFor(() =>
    expect(mocks.merge).toHaveBeenCalledWith({
      targetId: 'b',
      people: [
        { id: 'a', rowVersion: 2 },
        { id: 'b', rowVersion: 2 },
      ],
    }),
  );
  expect(mocks.suggest).toHaveBeenCalledTimes(1);
});
it('allows an explicit retained target, opens its photo and blocks duplicate submits', async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.merge.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  for (const name of ['选择 未命名分组 1', '选择 小明'])
    fireEvent.click(await screen.findByRole('checkbox', { name }));
  fireEvent.change(screen.getByRole('combobox', { name: '保留人物' }), { target: { value: 'a' } });
  fireEvent.click(screen.getByRole('button', { name: '合并所选人物' }));
  expect(screen.getByRole('button', { name: '正在合并…' })).toBeDisabled();
  expect(mocks.merge).toHaveBeenCalledTimes(1);
  finish({ id: 'a', rowVersion: 2, photoCount: 2, marksAssetsPrivate: false });
  await screen.findByText('人物已合并');
  expect(screen.queryByRole('checkbox', { name: '选择 小明' })).not.toBeInTheDocument();
});
it('keeps existing cards when prefetch fails and offers an in-place retry on the next batch', async () => {
  mocks.suggest.mockImplementation(async (after?: string) => {
    if (after) throw new Error('下一批加载失败');
    return { items, nextCursor: 'next' };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  await screen.findByRole('checkbox', { name: '选择 未命名分组 1' });
  await screen.findByRole('alert');
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '下一组' }));
  await screen.findByRole('button', { name: '继续查找相似人物' });
});

it('refreshes only the conflicted batch and requires a fresh selection instead of retrying a stale merge', async () => {
  mocks.merge.mockRejectedValue(new ApiError('人物已变化', 409, null));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  for (const name of ['选择 未命名分组 1', '选择 小明'])
    fireEvent.click(await screen.findByRole('checkbox', { name }));
  fireEvent.click(screen.getByRole('button', { name: '合并所选人物' }));
  await waitFor(() => expect(mocks.suggest).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: '选择 未命名分组 1' })).not.toBeChecked(),
  );
  expect(mocks.merge).toHaveBeenCalledTimes(1);
});
it('initial request failures offer retry without pretending the library has no candidates', async () => {
  mocks.suggest.mockRejectedValue(new Error('请求失败'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  await screen.findByRole('button', { name: '重试' });
  expect(screen.queryByText('暂时没有需要确认的相似人物。')).not.toBeInTheDocument();
});

it('orders the nine review cards by photo count before similarity', async () => {
  const large = { ...person('large'), photoCount: 600 };
  const medium = { ...person('medium'), photoCount: 300 };
  const tiny = { ...person('tiny'), photoCount: 1 };
  mocks.suggest.mockResolvedValue({
    items: [
      { key: 'tiny:medium', first: tiny, second: medium, similarity: 0.99 },
      { key: 'large:medium', first: large, second: medium, similarity: 0.7 },
    ],
    nextCursor: null,
  });
  show();
  fireEvent.click(await screen.findByRole('tab', { name: '待确认' }));
  await screen.findByText('600 张照片');
  expect(screen.getAllByRole('checkbox').map((el) => el.closest('article')?.textContent)).toEqual([
    expect.stringContaining('600 张照片'),
    expect.stringContaining('300 张照片'),
    expect.stringContaining('1 张照片'),
  ]);
});
it('selects unnamed groups across pages and merges into an existing named person in one request', async () => {
  mocks.options.mockResolvedValue({
    people: [{ id: b.id, name: b.name, rowVersion: 7, marksAssetsPrivate: false }],
    nextCursor: null,
  });
  mocks.list.mockImplementation(
    async (after: string | undefined, _signal: unknown, view: string) => ({
      runtimeConfigured: true,
      people: view === 'UNNAMED' ? [after ? c : a] : [b],
      nextCursor: view === 'UNNAMED' && !after ? 'page2' : null,
    }),
  );
  mocks.merge.mockResolvedValue({
    id: b.id,
    rowVersion: 8,
    marksAssetsPrivate: false,
    photoCount: 20,
    mergedIds: [a.id, c.id],
  });
  show();
  fireEvent.click(await screen.findByRole('tab', { name: /^待整理分组/ }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择分组 a' }));
  fireEvent.click(screen.getByRole('button', { name: '加载更多人物' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择分组 c' }));
  fireEvent.change(await screen.findByRole('combobox', { name: '合并到人物' }), {
    target: { value: b.id },
  });
  const before = mocks.list.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '合并所选分组' }));
  await waitFor(() => expect(mocks.merge).toHaveBeenCalledTimes(1));
  expect(mocks.merge).toHaveBeenCalledWith({
    targetId: b.id,
    people: [
      { id: a.id, rowVersion: 1 },
      { id: c.id, rowVersion: 1 },
      { id: b.id, rowVersion: 7 },
    ],
  });
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: '选择分组 a' })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole('checkbox', { name: '选择分组 c' })).not.toBeInTheDocument();
  expect(mocks.list).toHaveBeenCalledTimes(before);
});
