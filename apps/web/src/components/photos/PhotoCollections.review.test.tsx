import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import type { PhotoPerson } from '../../lib/photo-management-api';
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  suggest: vi.fn(),
  decide: vi.fn(),
}));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  getPhotoPeopleSummary: mocks.summary,
  getPhotoPeopleReview: mocks.suggest,
  decidePhotoPeople: mocks.decide,
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
it('defaults to named people and makes the review entry explicit, not a wall of thousands of avatars', async () => {
  show();
  await screen.findByRole('button', { name: '小明' });
  expect(screen.getByRole('tab', { name: '已命名人物 (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByText('有 3000 个头像待整理，可先确认相似人物。')).toBeVisible();
  expect(mocks.suggest).not.toHaveBeenCalled();
  expect(mocks.list.mock.calls[0]?.[2]).toBe('NAMED');
});
it('uses the server-recommended pair and persists SAME with both current versions', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('button', { name: '是，同一个人' }));
  await waitFor(() =>
    expect(mocks.decide).toHaveBeenCalledWith({
      firstId: 'a',
      secondId: 'b',
      firstVersion: 1,
      secondVersion: 1,
      decision: 'SAME',
    }),
  );
  expect(await screen.findByText('人物已合并')).toBeVisible();
  expect(await screen.findByRole('button', { name: '是，同一个人' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '是，同一个人' }), { detail: 2 });
  expect(mocks.decide).toHaveBeenCalledTimes(1);
});
it('persists DIFFERENT instead of silently skipping or merging', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('button', { name: '不是同一个人' }));
  await waitFor(() => expect(mocks.decide.mock.calls[0]?.[0].decision).toBe('DIFFERENT'));
  expect(await screen.findByText('已记住：不是同一个人。')).toBeVisible();
});
it('skip changes the suggestion without saving an identity decision', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  const region = await screen.findByRole('region', { name: '这两张照片是同一个人吗？' });
  expect((await within(region).findAllByRole('img'))[0]).toHaveAttribute('src', '/a');
  fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }));
  expect(within(region).getAllByRole('img')[2]).toHaveAttribute('src', '/c');
  expect(mocks.decide).not.toHaveBeenCalled();
});
it('failed or stale decisions show the error and do not advance', async () => {
  mocks.decide.mockRejectedValue(new Error('人物已变化，请刷新后重试。'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('button', { name: '是，同一个人' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('人物已变化');
  expect(screen.getByRole('button', { name: '是，同一个人' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('never falls back to arbitrary pairs when the server has no similarity candidates', async () => {
  mocks.suggest.mockResolvedValue({ items: [], nextCursor: null });
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  expect(await screen.findByText('暂时没有需要确认的相似人物。')).toBeVisible();
  expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument();
});
it('can traverse the full library instead of stopping at the directory page', async () => {
  mocks.suggest.mockImplementation(async (after?: string) =>
    after ? { items: [items[0]], nextCursor: null } : { items: [], nextCursor: 'next-anchor' },
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  fireEvent.click(await screen.findByRole('button', { name: '继续查找相似人物' }));
  await screen.findByRole('button', { name: '是，同一个人' });
  expect(mocks.suggest.mock.calls.some(([cursor]) => cursor === 'next-anchor')).toBe(true);
});

it('shows complete photos beside the crops and blocks held confirmation keys', async () => {
  show();
  fireEvent.click(await screen.findByRole('button', { name: '开始确认人物' }));
  const region = await screen.findByRole('region', { name: '这两张照片是同一个人吗？' });
  await waitFor(() => expect(within(region).getAllByRole('img')).toHaveLength(4));
  const button = screen.getByRole('button', { name: '是，同一个人' });
  expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(false);
  expect(mocks.decide).not.toHaveBeenCalled();
});
